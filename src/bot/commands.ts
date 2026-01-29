// src/bot/commands.ts
import {
  REST,
  Routes,
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  ChannelType,
  TextChannel,
} from 'discord.js';
import {
  saveProject,
  deleteProject,
  getProject,
  getProjectByChannelId,
} from '../config/store.js';
import {
  createContainer,
  removeContainer,
  getContainerStatus,
} from '../container/manager.js';
import { removeSession } from './client.js';
import { AppConfig } from '../config/types.js';

const commands = [
  new SlashCommandBuilder()
    .setName('new-project')
    .setDescription('Create a new project with its own channel and container')
    .addStringOption((opt) =>
      opt.setName('name').setDescription('Project name (lowercase, no spaces)').setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName('delete-project')
    .setDescription('Delete the project in this channel (removes container and channel)'),
  new SlashCommandBuilder()
    .setName('status')
    .setDescription('Show the status of the project in this channel'),
  new SlashCommandBuilder()
    .setName('restart')
    .setDescription('Restart the Claude session in this channel (fresh conversation)'),
  new SlashCommandBuilder()
    .setName('logs')
    .setDescription('Show recent logs from the Claude session'),
];

export async function registerCommands(config: AppConfig): Promise<void> {
  const rest = new REST({ version: '10' }).setToken(config.discordToken);
  await rest.put(
    Routes.applicationGuildCommands(
      // Application ID is fetched from the token
      Buffer.from(config.discordToken.split('.')[0], 'base64').toString(),
      config.guildId
    ),
    { body: commands.map((c) => c.toJSON()) }
  );
  console.log('Slash commands registered.');
}

export async function handleCommand(
  interaction: ChatInputCommandInteraction,
  config: AppConfig
): Promise<void> {
  // Only allow the configured user
  if (interaction.user.id !== config.userId) {
    await interaction.reply({ content: 'Unauthorized.', ephemeral: true });
    return;
  }

  switch (interaction.commandName) {
    case 'new-project':
      await handleNewProject(interaction, config);
      break;
    case 'delete-project':
      await handleDeleteProject(interaction, config);
      break;
    case 'status':
      await handleStatus(interaction);
      break;
    case 'restart':
      await handleRestart(interaction);
      break;
    case 'logs':
      await handleLogs(interaction);
      break;
  }
}

async function handleNewProject(
  interaction: ChatInputCommandInteraction,
  config: AppConfig
): Promise<void> {
  const name = interaction.options.getString('name', true).toLowerCase().replace(/[^a-z0-9-]/g, '-');

  // Check if project already exists
  if (getProject(name)) {
    await interaction.reply({ content: `Project **${name}** already exists.`, ephemeral: true });
    return;
  }

  await interaction.deferReply();

  try {
    // Create Discord channel
    const guild = interaction.guild!;
    const channel = await guild.channels.create({
      name: `project-${name}`,
      type: ChannelType.GuildText,
      topic: `Claude Code project: ${name}`,
    });

    // Create Docker container
    const { containerName, volumeName } = await createContainer(name, config.claudeHome);

    // Save project config
    saveProject(name, {
      channelId: channel.id,
      containerName,
      volumeName,
      createdAt: new Date().toISOString(),
    });

    await interaction.editReply(
      `Project **${name}** created!\n` +
      `Channel: <#${channel.id}>\n` +
      `Container: \`${containerName}\`\n\n` +
      `Head to the channel and start chatting with Claude!`
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    await interaction.editReply(`Failed to create project: ${msg}`);
  }
}

async function handleDeleteProject(
  interaction: ChatInputCommandInteraction,
  config: AppConfig
): Promise<void> {
  const project = getProjectByChannelId(interaction.channelId);
  if (!project) {
    await interaction.reply({ content: 'This channel is not a project channel.', ephemeral: true });
    return;
  }

  await interaction.deferReply();

  try {
    // Stop session
    removeSession(interaction.channelId);

    // Remove container and volume
    await removeContainer(project.config.containerName, project.config.volumeName);

    // Remove from config
    deleteProject(project.name);

    await interaction.editReply(
      `Project **${project.name}** deleted. Container and volume removed.\n` +
      `You can delete this channel manually.`
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    await interaction.editReply(`Failed to delete project: ${msg}`);
  }
}

async function handleStatus(interaction: ChatInputCommandInteraction): Promise<void> {
  const project = getProjectByChannelId(interaction.channelId);
  if (!project) {
    await interaction.reply({ content: 'This channel is not a project channel.', ephemeral: true });
    return;
  }

  const status = await getContainerStatus(project.config.containerName);
  if (!status) {
    await interaction.reply(`**${project.name}** - Container not found. Try \`/restart\`.`);
    return;
  }

  await interaction.reply(
    `**${project.name}**\n` +
    `Container: \`${status.name}\` - ${status.running ? 'Running' : 'Stopped'}\n` +
    `Created: ${project.config.createdAt}`
  );
}

async function handleRestart(interaction: ChatInputCommandInteraction): Promise<void> {
  const project = getProjectByChannelId(interaction.channelId);
  if (!project) {
    await interaction.reply({ content: 'This channel is not a project channel.', ephemeral: true });
    return;
  }

  await interaction.deferReply();

  // Kill existing session - a new one starts on next message
  removeSession(interaction.channelId);

  await interaction.editReply('Claude session restarted. Send a message to start a fresh conversation.');
}

async function handleLogs(interaction: ChatInputCommandInteraction): Promise<void> {
  // Placeholder - will be enhanced later
  await interaction.reply('Logs feature coming soon.');
}
