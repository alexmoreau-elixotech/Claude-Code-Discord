// src/bot/commands.ts
import {
  REST,
  Routes,
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  ChannelType,
  TextChannel,
  EmbedBuilder,
  AttachmentBuilder,
} from 'discord.js';
import {
  saveProject,
  deleteProject,
  getProject,
  getProjectByChannelId,
  getNextPreviewPort,
} from '../config/store.js';
import {
  createContainer,
  removeContainer,
  recreateContainer,
  getContainerStatus,
  execInContainer,
  readFileFromContainer,
} from '../container/manager.js';
import { removeSession } from './client.js';
import { AppConfig } from '../config/types.js';
import { addDownload } from '../web/server.js';

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
  new SlashCommandBuilder()
    .setName('help')
    .setDescription('Show what you can do with Claude and example prompts'),
  new SlashCommandBuilder()
    .setName('export')
    .setDescription('Download your project as a zip file'),
  new SlashCommandBuilder()
    .setName('preview')
    .setDescription('Preview your website in a browser')
    .addStringOption((opt) =>
      opt.setName('action')
        .setDescription('Start or stop the preview')
        .addChoices(
          { name: 'start', value: 'start' },
          { name: 'stop', value: 'stop' },
        )
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
    case 'help':
      await handleHelp(interaction);
      break;
    case 'export':
      await handleExport(interaction, config);
      break;
    case 'preview':
      await handlePreview(interaction, config);
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

    // Send welcome message in the new channel
    const welcomeEmbed = new EmbedBuilder()
      .setTitle(`Welcome to ${name}!`)
      .setDescription(
        "I'm Claude, your coding assistant. Tell me what you'd like to build and I'll get started.\n\n" +
        '**Try saying something like:**\n' +
        '\u2022 "Build me a simple landing page"\n' +
        '\u2022 "Create a Python script that renames files"\n' +
        '\u2022 "Clone [repo URL] and set it up"\n\n' +
        'Each message creates a thread so your channel stays organized. Type `/help` for more examples.'
      )
      .setColor(0x7c3aed);

    await (channel as TextChannel).send({ embeds: [welcomeEmbed] });

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
    project.config.previewPid = undefined;
    saveProject(project.name, project.config);
    await recreateContainer(project.name, {
      claudeHome: config.claudeHome,
      sshPath: config.sshPath,
      gitconfigPath: config.gitconfigPath,
      ghToken: config.ghToken,
      claudeMdPath: config.claudeMdPath,
      gitUserName: config.gitUserName,
      gitUserEmail: config.gitUserEmail,
      envVars,
      previewPort: project.config.previewPort,
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

    // Kill session and recreate container
    removeSession(interaction.channelId);
    project.config.previewPid = undefined;
    saveProject(project.name, project.config);
    await recreateContainer(project.name, {
      claudeHome: config.claudeHome,
      sshPath: config.sshPath,
      gitconfigPath: config.gitconfigPath,
      ghToken: config.ghToken,
      claudeMdPath: config.claudeMdPath,
      gitUserName: config.gitUserName,
      gitUserEmail: config.gitUserEmail,
      envVars: project.config.envVars,
      previewPort: project.config.previewPort,
    });

    await interaction.editReply(`Removed \`${key}\` and recreated container.`);
  }
}

async function handleExport(
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
    // Create zip inside container
    const zipPath = '/tmp/export.zip';
    const { exitCode, stderr } = await execInContainer(project.config.containerName, [
      'bash', '-c',
      `cd /workspace && zip -r ${zipPath} . -x "node_modules/*" ".git/*" "dist/*" "__pycache__/*" ".cache/*"`,
    ]);

    if (exitCode !== 0) {
      await interaction.editReply(`Failed to create zip: ${stderr}`);
      return;
    }

    // Get file size
    const { stdout: sizeOut } = await execInContainer(project.config.containerName, [
      'stat', '-c', '%s', zipPath,
    ]);
    const fileSize = parseInt(sizeOut.trim(), 10);
    const fileSizeMB = (fileSize / (1024 * 1024)).toFixed(1);

    // Get file count
    const { stdout: countOut } = await execInContainer(project.config.containerName, [
      'bash', '-c', 'find /workspace -not -path "*/node_modules/*" -not -path "*/.git/*" -not -path "*/dist/*" -not -path "*/__pycache__/*" -not -path "*/.cache/*" -type f | wc -l',
    ]);
    const fileCount = countOut.trim();

    const MAX_DISCORD_SIZE = 25 * 1024 * 1024; // 25MB

    if (fileSize <= MAX_DISCORD_SIZE) {
      // Read zip and send as Discord attachment
      const zipBuffer = await readFileFromContainer(project.config.containerName, zipPath);
      const attachment = new AttachmentBuilder(zipBuffer, {
        name: `${project.name}.zip`,
        description: `Project export of ${project.name}`,
      });

      const embed = new EmbedBuilder()
        .setTitle('Project exported')
        .setDescription(`**${project.name}** \u2014 ${fileCount} files, ${fileSizeMB} MB`)
        .setColor(0x00cc00);

      await interaction.editReply({ embeds: [embed], files: [attachment] });
    } else {
      // Too large for Discord — serve via web dashboard
      const zipBuffer = await readFileFromContainer(project.config.containerName, zipPath);
      const downloadId = addDownload(`${project.name}.zip`, zipBuffer);
      const port = process.env.PORT || 3456;

      const embed = new EmbedBuilder()
        .setTitle('Project exported')
        .setDescription(
          `**${project.name}** \u2014 ${fileCount} files, ${fileSizeMB} MB\n\n` +
          `File is too large for Discord. Download it here (link expires in 10 minutes):\n` +
          `http://localhost:${port}/download/${downloadId}`
        )
        .setColor(0x00cc00);

      await interaction.editReply({ embeds: [embed] });
    }

    // Clean up zip inside container
    await execInContainer(project.config.containerName, ['rm', '-f', zipPath]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    await interaction.editReply(`Failed to export: ${msg}`);
  }
}

async function handleHelp(interaction: ChatInputCommandInteraction): Promise<void> {
  const embed = new EmbedBuilder()
    .setTitle('Claude Code Assistant')
    .setDescription('Chat with Claude to build, fix, and manage code projects. Here are some things you can try:')
    .addFields(
      {
        name: 'Build something new',
        value: [
          '\u2022 "Build me a personal portfolio website"',
          '\u2022 "Create a to-do app with a nice UI"',
          '\u2022 "Make a Discord bot that posts daily quotes"',
        ].join('\n'),
      },
      {
        name: 'Work with existing code',
        value: [
          '\u2022 "Clone https://github.com/user/repo and explain what it does"',
          '\u2022 "Fix the bug in index.html"',
          '\u2022 "Add a dark mode toggle to the website"',
        ].join('\n'),
      },
      {
        name: 'Manage your project',
        value: [
          '\u2022 `/export` \u2014 Download your project as a zip file',
          '\u2022 `/preview` \u2014 See your website in a browser',
          '\u2022 `/status` \u2014 Check if your project is running',
          '\u2022 `/restart` \u2014 Start a fresh conversation',
        ].join('\n'),
      },
      {
        name: 'Tips',
        value: [
          '\u2022 Each message creates a thread \u2014 reply in the thread to continue the conversation',
          '\u2022 You can attach files \u2014 Claude will read them in your project',
          '\u2022 Be specific about what you want \u2014 Claude works best with clear instructions',
        ].join('\n'),
      },
    )
    .setColor(0x7c3aed);

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

async function handlePreview(
  interaction: ChatInputCommandInteraction,
  config: AppConfig
): Promise<void> {
  const project = getProjectByChannelId(interaction.channelId);
  if (!project) {
    await interaction.reply({ content: 'This channel is not a project channel.', ephemeral: true });
    return;
  }

  const action = interaction.options.getString('action') || 'start';

  if (action === 'stop') {
    if (!project.config.previewPid) {
      await interaction.reply({ content: 'No preview is running.', ephemeral: true });
      return;
    }

    await interaction.deferReply();
    await execInContainer(project.config.containerName, [
      'bash', '-c', `kill ${project.config.previewPid} 2>/dev/null; true`,
    ]);
    project.config.previewPid = undefined;
    saveProject(project.name, project.config);
    await interaction.editReply('Preview stopped.');
    return;
  }

  // Start preview
  await interaction.deferReply();

  try {
    let port = project.config.previewPort;

    // If no port assigned yet, assign one and recreate container with port mapping
    if (!port) {
      port = getNextPreviewPort();
      project.config.previewPort = port;
      saveProject(project.name, project.config);

      // Kill session and recreate container with port mapping
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
        previewPort: port,
      });
    }

    // Kill any existing preview server
    if (project.config.previewPid) {
      await execInContainer(project.config.containerName, [
        'bash', '-c', `kill ${project.config.previewPid} 2>/dev/null; true`,
      ]);
    }

    // Start a static file server inside the container
    const { exitCode: serveCheck } = await execInContainer(project.config.containerName, [
      'bash', '-c', 'which npx',
    ]);

    let serverCmd: string;
    if (serveCheck === 0) {
      serverCmd = `npx --yes serve /workspace -l ${port} -s --no-clipboard`;
    } else {
      serverCmd = `python3 -m http.server ${port} --directory /workspace`;
    }

    // Start server in background and capture PID
    const { stdout: pidOut } = await execInContainer(project.config.containerName, [
      'bash', '-c', `${serverCmd} > /tmp/preview.log 2>&1 & echo $!`,
    ]);
    const pid = parseInt(pidOut.trim(), 10);
    if (!Number.isInteger(pid) || pid <= 0) {
      throw new Error('Failed to start preview server');
    }
    project.config.previewPid = pid;
    saveProject(project.name, project.config);

    // Wait briefly for server to start
    await new Promise((r) => setTimeout(r, 2000));

    const embed = new EmbedBuilder()
      .setTitle('Preview is live')
      .setDescription(
        `Your project is running at:\n**http://localhost:${port}**\n\n` +
        'Use `/preview stop` to shut it down.'
      )
      .setColor(0x7c3aed);

    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    await interaction.editReply(`Failed to start preview: ${msg}`);
  }
}
