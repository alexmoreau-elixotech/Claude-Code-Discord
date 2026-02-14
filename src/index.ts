// src/index.ts
import 'dotenv/config';
import { Events } from 'discord.js';
import { loadAppConfigFromFile } from './config/types.js';
import { createClient } from './bot/client.js';
import { registerCommands, handleCommand } from './bot/commands.js';
import { imageExists, buildImage } from './container/manager.js';
import { getAllProjects } from './config/store.js';
import { ensureContainerRunning } from './container/manager.js';
import { startWebServer, setOnSetupComplete } from './web/server.js';
import { isSetupComplete, readConfig } from './config/config-file.js';

let botRunning = false;

async function startBot(): Promise<void> {
  if (botRunning) return;

  const fileConfig = readConfig();
  const config = loadAppConfigFromFile(fileConfig);

  // Check Docker image exists
  const hasImage = await imageExists();
  if (!hasImage) {
    console.log('Building Docker image (first run)...');
    await buildImage();
    console.log('Docker image built.');
  }

  // Create Discord client
  const client = createClient(config);

  client.on(Events.ClientReady, async () => {
    await registerCommands(config);

    // Reconnect existing project containers
    const projects = getAllProjects();
    for (const [name, project] of Object.entries(projects)) {
      const running = await ensureContainerRunning(project.containerName);
      console.log(`Project ${name}: container ${running ? 'running' : 'not found'}`);
    }
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    await handleCommand(interaction, config);
  });

  await client.login(config.discordToken);
  botRunning = true;
  console.log('Discord bot started.');
}

async function main(): Promise<void> {
  console.log('Claude Code Assistant starting...');

  // Register callback for when setup completes via web UI
  setOnSetupComplete(startBot);

  // Always start the web server
  await startWebServer();

  // If setup is complete, also start the bot
  if (isSetupComplete()) {
    console.log('Setup complete. Starting Discord bot...');
    await startBot();
  } else {
    console.log('Setup not complete. Open http://localhost:3456 to configure.');
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});

// Graceful shutdown
function shutdown(signal: string) {
  console.log(`\n${signal} received. Shutting down...`);
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
