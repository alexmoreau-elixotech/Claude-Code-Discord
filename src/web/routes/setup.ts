import { Router } from 'express';
import { REST } from 'discord.js';
import { writeConfig, isSetupComplete, type SetupConfig } from '../../config/config-file.js';
import { imageExists, buildImage } from '../../container/manager.js';
import { getOnSetupComplete } from '../server.js';

export function setupRoutes(): Router {
  const router = Router();

  // Check if setup is already complete
  router.get('/status', (_req, res) => {
    res.json({
      setupComplete: isSetupComplete(),
    });
  });

  // Validate Discord bot token
  router.post('/validate-token', async (req, res) => {
    const { token } = req.body;
    if (!token) {
      res.status(400).json({ error: 'Token is required' });
      return;
    }

    try {
      const rest = new REST({ version: '10' }).setToken(token);
      const bot = await rest.get('/users/@me') as { id: string; username: string };
      const appId = Buffer.from(token.split('.')[0], 'base64').toString();
      res.json({
        valid: true,
        botName: bot.username,
        botId: bot.id,
        appId,
      });
    } catch {
      res.json({ valid: false, error: 'Invalid token' });
    }
  });

  // List guilds the bot is in
  router.post('/guilds', async (req, res) => {
    const { token } = req.body;
    try {
      const rest = new REST({ version: '10' }).setToken(token);
      const guilds = await rest.get('/users/@me/guilds') as Array<{ id: string; name: string; icon: string | null }>;
      res.json(guilds.map(g => ({ id: g.id, name: g.name, icon: g.icon })));
    } catch {
      res.status(400).json({ error: 'Failed to fetch guilds' });
    }
  });

  // List roles in a guild
  router.post('/guild-roles', async (req, res) => {
    const { token, guildId } = req.body;
    try {
      const rest = new REST({ version: '10' }).setToken(token);
      const roles = await rest.get(`/guilds/${guildId}/roles`) as Array<{ id: string; name: string; position: number }>;
      const filtered = roles
        .filter(r => r.name !== '@everyone')
        .sort((a, b) => b.position - a.position);
      res.json(filtered.map(r => ({ id: r.id, name: r.name })));
    } catch {
      res.status(400).json({ error: 'Failed to fetch roles' });
    }
  });

  // Check if Docker project image exists
  router.get('/docker-image', async (_req, res) => {
    const exists = await imageExists();
    res.json({ exists });
  });

  // Build Docker project image
  router.post('/build-image', async (_req, res) => {
    try {
      const exists = await imageExists();
      if (exists) {
        res.json({ success: true, message: 'Image already exists' });
        return;
      }
      await buildImage();
      res.json({ success: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      res.status(500).json({ error: msg });
    }
  });

  // Save configuration and complete setup
  router.post('/save', async (req, res) => {
    const config: SetupConfig = req.body;

    if (!config.discord?.token || !config.discord?.guildId) {
      res.status(400).json({ error: 'Discord token and guild ID are required' });
      return;
    }
    if (!config.discord.userId && !config.discord.roleId) {
      res.status(400).json({ error: 'Must set userId or roleId (or both)' });
      return;
    }

    config.setupComplete = true;
    writeConfig(config);

    // Start the bot
    const onComplete = getOnSetupComplete();
    if (onComplete) {
      try {
        await onComplete();
      } catch (err) {
        console.error('Failed to start bot after setup:', err);
      }
    }

    res.json({ success: true });
  });

  // Generate bot invite URL
  router.post('/invite-url', (req, res) => {
    const { appId } = req.body;
    if (!appId) {
      res.status(400).json({ error: 'appId is required' });
      return;
    }
    // Permissions: Send Messages, Manage Channels, Read Message History,
    // Attach Files, Add Reactions, Manage Messages, Create Public Threads
    const permissions = '397821715456';
    const url = `https://discord.com/api/oauth2/authorize?client_id=${appId}&permissions=${permissions}&scope=bot%20applications.commands`;
    res.json({ url });
  });

  return router;
}
