import { Router } from 'express';
import { readConfig, isSetupComplete } from '../../config/config-file.js';
import { getAllProjects } from '../../config/store.js';
import { getContainerStatus } from '../../container/manager.js';

export function dashboardRoutes(): Router {
  const router = Router();

  // Overall status
  router.get('/status', async (_req, res) => {
    const complete = isSetupComplete();
    if (!complete) {
      res.json({ setupComplete: false });
      return;
    }

    const config = readConfig();
    const projects = getAllProjects();
    const projectStatuses = [];

    for (const [name, project] of Object.entries(projects)) {
      const status = await getContainerStatus(project.containerName);
      projectStatuses.push({
        name,
        channelId: project.channelId,
        running: status?.running ?? false,
        state: status?.state ?? 'not found',
        createdAt: project.createdAt,
      });
    }

    res.json({
      setupComplete: true,
      botConfigured: true,
      guildId: config.discord.guildId,
      projects: projectStatuses,
    });
  });

  // Get config (redacted)
  router.get('/config', (_req, res) => {
    if (!isSetupComplete()) {
      res.json({ setupComplete: false });
      return;
    }

    const config = readConfig();
    res.json({
      discord: {
        guildId: config.discord.guildId,
        hasToken: !!config.discord.token,
        userId: config.discord.userId,
        roleId: config.discord.roleId,
      },
      claudeHome: config.claudeHome,
      github: {
        hasToken: !!config.github?.token,
      },
      git: config.git,
      hasClaudeMd: !!config.claudeMd,
      setupComplete: config.setupComplete,
    });
  });

  return router;
}
