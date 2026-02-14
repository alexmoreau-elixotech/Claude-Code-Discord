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
  recreateContainer,
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
  new SlashCommandBuilder()
    .setName('env')
    .setDescription('Manage environment variables for this project')
    .addSubcommand((sub) =>
      sub.setName('set')
        .setDescription('Set an environment variable (recreates container)')
        .addStringOption((opt) => opt.setName('key').setDescription('Variable name').setRequired(true))
        .addStringOption((opt) => opt.setName('value').setDescription('Variable value').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub.setName('remove')
        .setDescription('Remove an environment variable (recreates container)')
        .addStringOption((opt) => opt.setName('key').setDescription('Variable name').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub.setName('list')
        .setDescription('List all environment variables for this project')
    ),
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
  // Authorization: check role or user ID
  const member = interaction.member as { roles: { cache: Map<string, unknown> } } | null;
  const hasRole = config.roleId && member?.roles.cache.has(config.roleId);
  const isUser = config.userId && interaction.user.id === config.userId;
  if (!hasRole && !isUser) {
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
    case 'env':
      await handleEnv(interaction, config);
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
    // Create Docker container first (more likely to fail)
    const { containerName, volumeName } = await createContainer(name, {
      claudeHome: config.claudeHome,
      sshPath: config.sshPath,
      gitconfigPath: config.gitconfigPath,
      ghToken: config.ghToken,
      claudeMdPath: config.claudeMdPath,
      gitUserName: config.gitUserName,
      gitUserEmail: config.gitUserEmail,
    });

    // Create Discord channel under a "Claude Projects" category
    const guild = interaction.guild!;
    let category = guild.channels.cache.find(
      (c) => c.name === 'Claude Projects' && c.type === ChannelType.GuildCategory
    );
    if (!category) {
      category = await guild.channels.create({
        name: 'Claude Projects',
        type: ChannelType.GuildCategory,
      });
    }

    const channel = await guild.channels.create({
      name: `project-${name}`,
      type: ChannelType.GuildText,
      topic: `Claude Code project: ${name}`,
      parent: category.id,
    });

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
  _config: AppConfig
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

async function handleEnv(
  interaction: ChatInputCommandInteraction,
  config: AppConfig
): Promise<void> {
  const project = getProjectByChannelId(interaction.channelId);
  if (!project) {
    await interaction.reply({ content: 'This channel is not a project channel.', ephemeral: true });
    return;
  }

  const sub = interaction.options.getSubcommand();

  if (sub === 'list') {
    const vars = project.config.envVars || {};
    const entries = Object.entries(vars);
    if (entries.length === 0) {
      await interaction.reply('No project environment variables set.');
      return;
    }
    const list = entries.map(([k, v]) => `\`${k}\` = \`${v}\``).join('\n');
    await interaction.reply(`**Environment variables:**\n${list}`);
    return;
  }

  const key = interaction.options.getString('key', true);

  if (sub === 'set') {
    const value = interaction.options.getString('value', true);
    await interaction.deferReply();

    const envVars = { ...project.config.envVars, [key]: value };
    project.config.envVars = envVars;
    saveProject(project.name, project.config);

    // Kill session and recreate container with new env vars
    removeSession(interaction.channelId);
    await recreateContainer(project.name, {
      claudeHome: config.claudeHome,
      sshPath: config.sshPath,
      gitconfigPath: config.gitconfigPath,
      ghToken: config.ghToken,
      claudeMdPath: config.claudeMdPath,
      gitUserName: config.gitUserName,
      gitUserEmail: config.gitUserEmail,
      envVars,
    });

    await interaction.editReply(`Set \`${key}\` and recreated container.`);
  } else if (sub === 'remove') {
    await interaction.deferReply();

    const envVars = { ...project.config.envVars };
    if (!(key in envVars)) {
      await interaction.editReply(`\`${key}\` is not set.`);
      return;
    }
    delete envVars[key];
    project.config.envVars = Object.keys(envVars).length > 0 ? envVars : undefined;
    saveProject(project.name, project.config);

    // Kill session and recreate container
    removeSession(interaction.channelId);
    await recreateContainer(project.name, {
      claudeHome: config.claudeHome,
      sshPath: config.sshPath,
      gitconfigPath: config.gitconfigPath,
      ghToken: config.ghToken,
      claudeMdPath: config.claudeMdPath,
      gitUserName: config.gitUserName,
      gitUserEmail: config.gitUserEmail,
      envVars: project.config.envVars,
    });

    await interaction.editReply(`Removed \`${key}\` and recreated container.`);
  }
}
