// src/index.ts
import 'dotenv/config';
import { Events } from 'discord.js';
import { loadAppConfig } from './config/types.js';
import { createClient } from './bot/client.js';
import { registerCommands, handleCommand } from './bot/commands.js';
import { imageExists, buildImage } from './container/manager.js';
import { getAllProjects } from './config/store.js';
import { ensureContainerRunning } from './container/manager.js';

async function main(): Promise<void> {
  console.log('Claude Code Assistant starting...');

  // Load config
  const config = loadAppConfig();

  // Check Docker image exists
  const hasImage = await imageExists();
  if (!hasImage) {
    console.log('Building Docker image (first run)...');
    await buildImage(process.cwd());
    console.log('Docker image built.');
  }

  // Create Discord client
  const client = createClient(config);

  // Register slash commands
  client.on(Events.ClientReady, async () => {
    await registerCommands(config);

    // Reconnect existing project containers
    const projects = getAllProjects();
    for (const [name, project] of Object.entries(projects)) {
      const running = await ensureContainerRunning(project.containerName);
      console.log(`Project ${name}: container ${running ? 'running' : 'not found'}`);
    }
  });

  // Handle slash commands
  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    await handleCommand(interaction, config);
  });

  // Login
  await client.login(config.discordToken);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
