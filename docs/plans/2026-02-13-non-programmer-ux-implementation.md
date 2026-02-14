# Non-Programmer UX Improvements — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add `/help`, `/export`, `/preview` commands and friendly error messages to make Claude Code Assistant usable by non-programmers.

**Architecture:** Four independent features added to the existing Discord bot. Each feature adds a slash command handler in `commands.ts` with supporting utilities. The friendly error system is a pattern-matching layer in `formatter.ts` applied at Discord output points.

**Tech Stack:** TypeScript, discord.js v14 (embeds, slash commands), dockerode (container exec, port mapping), Express (download fallback route)

---

## Task 1: Add friendly error messages to `formatter.ts`

This is a pure function with no dependencies on other tasks, so it's a good warm-up.

**Files:**
- Modify: `src/bot/formatter.ts` (add `friendlyError()` function at bottom)
- Modify: `src/bot/client.ts:73` (wrap "Container is not running" message)
- Modify: `src/bot/client.ts:146` (wrap "Failed to send message" error)
- Modify: `src/bot/client.ts:344` (wrap error embed text)
- Modify: `src/bot/client.ts:368` (wrap "session ended unexpectedly" message)

**Step 1: Add `friendlyError()` to formatter.ts**

Add this at the bottom of `src/bot/formatter.ts`:

```typescript
const ERROR_PATTERNS: Array<{ pattern: RegExp; friendly: string }> = [
  { pattern: /container is not running/i, friendly: "Claude's workspace isn't running. Use `/restart` to start it back up." },
  { pattern: /prompt is too long|context.*(overflow|window)/i, friendly: 'The conversation got too long — Claude is starting fresh and will retry your message.' },
  { pattern: /ECONNREFUSED|docker.*(socket|connect)|Cannot connect/i, friendly: "Can't connect to Docker. Make sure Docker Desktop is running on your computer." },
  { pattern: /exited? with code [1-9]/i, friendly: 'Something went wrong. Try `/restart` to start a new conversation.' },
  { pattern: /image.*not found|build.*fail/i, friendly: 'Setting up the workspace for the first time — this may take a few minutes.' },
  { pattern: /ENOMEM|out of memory|OOM/i, friendly: 'The project ran out of memory. Try restarting with `/restart`.' },
  { pattern: /permission denied|EACCES/i, friendly: "Claude doesn't have permission to do that. This shouldn't happen — try `/restart`." },
];

export function friendlyError(error: string): string {
  for (const { pattern, friendly } of ERROR_PATTERNS) {
    if (pattern.test(error)) {
      return friendly;
    }
  }
  return `Something unexpected happened.\n||${error}||`;
}
```

**Step 2: Apply `friendlyError()` in client.ts**

In `src/bot/client.ts`, add `friendlyError` to the import from `./formatter.js` (line 19-21):

```typescript
import {
  formatTextResponse,
  containsQuestion,
  friendlyError,
} from './formatter.js';
```

Then replace these four error messages:

Line 73 — container not running:
```typescript
// Before:
await message.reply('Container is not running. Try `/restart` to fix.');
// After:
await message.reply(friendlyError('Container is not running'));
```

Line 146 — failed to send:
```typescript
// Before:
await thread.send('Failed to send message to Claude. Try `/restart`.');
// After:
await thread.send(friendlyError('Failed to send message to Claude'));
```

Line 344 — error embed:
```typescript
// Before:
await sendEmbed('Claude encountered an error while processing.', 0xcc0000);
// After:
await sendEmbed(friendlyError('Claude encountered an error while processing.'), 0xcc0000);
```

Line 368 — session exited:
```typescript
// Before:
await thread.send('Claude session ended unexpectedly. Use `/restart` to start a new session.');
// After:
await thread.send(friendlyError(`Session exited with code ${code}`));
```

**Step 3: Build and verify**

Run: `npm run build`
Expected: No TypeScript errors.

**Step 4: Commit**

```bash
git add src/bot/formatter.ts src/bot/client.ts
git commit -m "feat: add friendly error messages for non-programmers"
```

---

## Task 2: Add `/help` command

**Files:**
- Modify: `src/bot/commands.ts` (add command definition + handler + switch case)

**Step 1: Add the slash command definition**

In `src/bot/commands.ts`, add to the `commands` array (after the `env` command, around line 61):

```typescript
  new SlashCommandBuilder()
    .setName('help')
    .setDescription('Show what you can do with Claude and example prompts'),
```

**Step 2: Add the switch case**

In `handleCommand()` (around line 108), add:

```typescript
    case 'help':
      await handleHelp(interaction);
      break;
```

**Step 3: Add the handler function**

Add this function in `commands.ts`. Import `EmbedBuilder` from discord.js at the top:

```typescript
import {
  REST,
  Routes,
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  ChannelType,
  TextChannel,
  EmbedBuilder,
} from 'discord.js';
```

Then add the handler:

```typescript
async function handleHelp(interaction: ChatInputCommandInteraction): Promise<void> {
  const embed = new EmbedBuilder()
    .setTitle('Claude Code Assistant')
    .setDescription('Chat with Claude to build, fix, and manage code projects. Here are some things you can try:')
    .addFields(
      {
        name: 'Build something new',
        value: [
          '• "Build me a personal portfolio website"',
          '• "Create a to-do app with a nice UI"',
          '• "Make a Discord bot that posts daily quotes"',
        ].join('\n'),
      },
      {
        name: 'Work with existing code',
        value: [
          '• "Clone https://github.com/user/repo and explain what it does"',
          '• "Fix the bug in index.html"',
          '• "Add a dark mode toggle to the website"',
        ].join('\n'),
      },
      {
        name: 'Manage your project',
        value: [
          '• `/export` — Download your project as a zip file',
          '• `/preview` — See your website in a browser',
          '• `/status` — Check if your project is running',
          '• `/restart` — Start a fresh conversation',
        ].join('\n'),
      },
      {
        name: 'Tips',
        value: [
          '• Each message creates a thread — reply in the thread to continue the conversation',
          '• You can attach files — Claude will read them in your project',
          '• Be specific about what you want — Claude works best with clear instructions',
        ].join('\n'),
      },
    )
    .setColor(0x7c3aed);

  await interaction.reply({ embeds: [embed], ephemeral: true });
}
```

**Step 4: Build and verify**

Run: `npm run build`
Expected: No TypeScript errors.

**Step 5: Commit**

```bash
git add src/bot/commands.ts
git commit -m "feat: add /help command with example prompts"
```

---

## Task 3: Add welcome message to new project channels

**Files:**
- Modify: `src/bot/commands.ts:150-170` (inside `handleNewProject`, after channel creation)

**Step 1: Add welcome message after channel creation**

In `handleNewProject()`, after the `saveProject()` call (line 163) and before the `editReply` (line 165), add:

```typescript
    // Send welcome message in the new channel
    const welcomeEmbed = new EmbedBuilder()
      .setTitle(`Welcome to ${name}!`)
      .setDescription(
        "I'm Claude, your coding assistant. Tell me what you'd like to build and I'll get started.\n\n" +
        '**Try saying something like:**\n' +
        '• "Build me a simple landing page"\n' +
        '• "Create a Python script that renames files"\n' +
        '• "Clone [repo URL] and set it up"\n\n' +
        'Each message creates a thread so your channel stays organized. Type `/help` for more examples.'
      )
      .setColor(0x7c3aed);

    await (channel as TextChannel).send({ embeds: [welcomeEmbed] });
```

**Step 2: Build and verify**

Run: `npm run build`
Expected: No TypeScript errors.

**Step 3: Commit**

```bash
git add src/bot/commands.ts
git commit -m "feat: add welcome message to new project channels"
```

---

## Task 4: Add `/export` command

**Files:**
- Modify: `src/bot/commands.ts` (add command definition, switch case, handler)
- Modify: `src/container/manager.ts` (add `copyFileFromContainer()` helper)
- Modify: `src/web/server.ts` (add download route)

**Step 1: Add `copyFileFromContainer()` to manager.ts**

Add this function at the bottom of `src/container/manager.ts`:

```typescript
export async function copyFileFromContainer(
  containerName: string,
  srcPath: string,
): Promise<Buffer> {
  const container = docker.getContainer(containerName);
  const archive = await container.getArchive({ path: srcPath });

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    archive.on('data', (chunk: Buffer) => chunks.push(chunk));
    archive.on('end', () => resolve(Buffer.concat(chunks)));
    archive.on('error', reject);
  });
}
```

Note: `container.getArchive()` returns a tar stream. We'll handle tar extraction in the command handler. Actually, since the container already has `zip`, it's simpler to create the zip inside the container and then copy the raw zip bytes out.

Better approach — use `execInContainer` to zip, then use `getArchive` to pull the zip file. Since `getArchive` returns a tar wrapping the file, let's instead use Docker's `exec` + stdout stream to cat the file:

```typescript
export async function readFileFromContainer(
  containerName: string,
  filePath: string,
): Promise<Buffer> {
  const container = docker.getContainer(containerName);
  const exec = await container.exec({
    Cmd: ['cat', filePath],
    AttachStdout: true,
    AttachStderr: true,
    AttachStdin: false,
  });

  const stream = await exec.start({ hijack: true, stdin: false });

  return new Promise((resolve, reject) => {
    const stdoutChunks: Buffer[] = [];
    docker.modem.demuxStream(stream, {
      write: (chunk: Buffer) => stdoutChunks.push(chunk),
    } as unknown as NodeJS.WritableStream, {
      write: () => {},
    } as unknown as NodeJS.WritableStream);

    stream.on('end', () => resolve(Buffer.concat(stdoutChunks)));
    stream.on('error', reject);
  });
}
```

**Step 2: Add `/export` command definition to commands.ts**

Add to the `commands` array:

```typescript
  new SlashCommandBuilder()
    .setName('export')
    .setDescription('Download your project as a zip file'),
```

**Step 3: Add the switch case**

In `handleCommand()`:

```typescript
    case 'export':
      await handleExport(interaction, config);
      break;
```

**Step 4: Add the handler function**

Add import at top of `commands.ts`:

```typescript
import {
  createContainer,
  removeContainer,
  recreateContainer,
  getContainerStatus,
  execInContainer,
  readFileFromContainer,
} from '../container/manager.js';
```

Add the handler:

```typescript
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
      const { AttachmentBuilder } = await import('discord.js');
      const attachment = new AttachmentBuilder(zipBuffer, {
        name: `${project.name}.zip`,
        description: `Project export of ${project.name}`,
      });

      const embed = new EmbedBuilder()
        .setTitle('Project exported')
        .setDescription(`**${project.name}** — ${fileCount} files, ${fileSizeMB} MB`)
        .setColor(0x00cc00);

      await interaction.editReply({ embeds: [embed], files: [attachment] });
    } else {
      // Too large for Discord — serve via web dashboard
      const zipBuffer = await readFileFromContainer(project.config.containerName, zipPath);
      const { addDownload } = await import('../web/server.js');
      const downloadId = addDownload(`${project.name}.zip`, zipBuffer);
      const port = process.env.PORT || 3456;

      const embed = new EmbedBuilder()
        .setTitle('Project exported')
        .setDescription(
          `**${project.name}** — ${fileCount} files, ${fileSizeMB} MB\n\n` +
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
```

**Step 5: Add download route to server.ts**

In `src/web/server.ts`, add a download file store and route:

```typescript
import { randomUUID } from 'crypto';

interface PendingDownload {
  filename: string;
  data: Buffer;
  expiresAt: number;
}

const downloads = new Map<string, PendingDownload>();

export function addDownload(filename: string, data: Buffer): string {
  const id = randomUUID();
  downloads.set(id, {
    filename,
    data,
    expiresAt: Date.now() + 10 * 60 * 1000, // 10 minutes
  });
  return id;
}
```

Then inside `startWebServer()`, before the SPA fallback route, add:

```typescript
  // Download route for large exports
  app.get('/download/:id', (req, res) => {
    const dl = downloads.get(req.params.id);
    if (!dl || Date.now() > dl.expiresAt) {
      downloads.delete(req.params.id);
      res.status(404).send('Download expired or not found.');
      return;
    }
    res.setHeader('Content-Disposition', `attachment; filename="${dl.filename}"`);
    res.setHeader('Content-Type', 'application/zip');
    res.send(dl.data);
    downloads.delete(req.params.id);
  });
```

**Step 6: Build and verify**

Run: `npm run build`
Expected: No TypeScript errors.

**Step 7: Commit**

```bash
git add src/bot/commands.ts src/container/manager.ts src/web/server.ts
git commit -m "feat: add /export command to download project as zip"
```

---

## Task 5: Add `/preview` command

**Files:**
- Modify: `src/config/types.ts` (add preview fields to ProjectConfig)
- Modify: `src/config/store.ts` (add `getNextPreviewPort()` helper)
- Modify: `src/bot/commands.ts` (add command definition, switch case, handler)
- Modify: `src/container/manager.ts` (add port mapping support to `createContainer`)

**Step 1: Add preview fields to ProjectConfig**

In `src/config/types.ts`, update `ProjectConfig`:

```typescript
export interface ProjectConfig {
  channelId: string;
  containerName: string;
  volumeName: string;
  createdAt: string;
  envVars?: Record<string, string>;
  previewPort?: number;
  previewPid?: number;
}
```

**Step 2: Add port mapping support to container creation**

In `src/container/manager.ts`, update `ContainerOptions`:

```typescript
export interface ContainerOptions {
  claudeHome: string;
  sshPath?: string;
  gitconfigPath?: string;
  ghToken?: string;
  claudeMdPath?: string;
  gitUserName?: string;
  gitUserEmail?: string;
  envVars?: Record<string, string>;
  previewPort?: number;
}
```

In the `createContainer` function, add port binding to the `HostConfig`. Update the `docker.createContainer()` call (around line 129):

```typescript
  // Port mapping for preview
  const portBindings: Record<string, Array<{ HostPort: string }>> = {};
  const exposedPorts: Record<string, Record<string, never>> = {};
  if (mounts.previewPort) {
    const containerPort = `${mounts.previewPort}/tcp`;
    exposedPorts[containerPort] = {};
    portBindings[containerPort] = [{ HostPort: String(mounts.previewPort) }];
  }

  const container = await docker.createContainer({
    Image: IMAGE_NAME,
    name: containerName,
    Tty: false,
    OpenStdin: true,
    StdinOnce: false,
    Cmd: ['/bin/bash', '-c', startupCmd],
    WorkingDir: '/workspace',
    Env: env.length > 0 ? env : undefined,
    ExposedPorts: Object.keys(exposedPorts).length > 0 ? exposedPorts : undefined,
    HostConfig: {
      Binds: binds,
      RestartPolicy: { Name: 'unless-stopped' },
      PortBindings: Object.keys(portBindings).length > 0 ? portBindings : undefined,
    },
  });
```

**Step 3: Add `getNextPreviewPort()` to store.ts**

In `src/config/store.ts`, add:

```typescript
export function getNextPreviewPort(): number {
  const data = readProjects();
  const usedPorts = new Set<number>();
  for (const project of Object.values(data.projects)) {
    if (project.previewPort) {
      usedPorts.add(project.previewPort);
    }
  }
  let port = 4000;
  while (usedPorts.has(port)) {
    port++;
  }
  return port;
}
```

**Step 4: Add `/preview` command definition**

Add to the `commands` array in `commands.ts`:

```typescript
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
```

**Step 5: Add the switch case**

In `handleCommand()`:

```typescript
    case 'preview':
      await handlePreview(interaction, config);
      break;
```

**Step 6: Add the handler function**

Add import at top of `commands.ts`:

```typescript
import { getNextPreviewPort } from '../config/store.js';
```

Add to existing imports from `../container/manager.js`:

```typescript
import {
  createContainer,
  removeContainer,
  recreateContainer,
  getContainerStatus,
  execInContainer,
  readFileFromContainer,
} from '../container/manager.js';
```

Add the handler:

```typescript
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
    // Use npx serve if available, fallback to python3
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
    project.config.previewPid = pid;
    saveProject(project.name, project.config);

    // Wait briefly for server to start
    await new Promise((r) => setTimeout(r, 2000));

    const embed = new EmbedBuilder()
      .setTitle('Preview is live')
      .setDescription(
        `Your project is running at:\n**http://localhost:${port}**\n\n` +
        `Use \`/preview stop\` to shut it down.`
      )
      .setColor(0x7c3aed);

    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    await interaction.editReply(`Failed to start preview: ${msg}`);
  }
}
```

**Step 7: Update `recreateContainer` to pass previewPort**

The existing `recreateContainer` calls `createContainer` under the hood, which now accepts `previewPort` through `ContainerOptions`. Also update the calls in `handleEnv` (lines 285 and 311 in `commands.ts`) to include `previewPort`:

```typescript
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
```

Do this for both the `set` and `remove` branches in `handleEnv`.

**Step 8: Build and verify**

Run: `npm run build`
Expected: No TypeScript errors.

**Step 9: Commit**

```bash
git add src/config/types.ts src/config/store.ts src/container/manager.ts src/bot/commands.ts
git commit -m "feat: add /preview command to serve project in browser"
```

---

## Task 6: Final build, test, and commit

**Step 1: Full build**

Run: `npm run build`
Expected: Clean build, no errors.

**Step 2: Run existing tests**

Run: `npm test`
Expected: All existing tests pass (setup-api tests).

**Step 3: Verify slash command list is complete**

Check that the `commands` array in `commands.ts` now has these commands:
- `new-project`
- `delete-project`
- `status`
- `restart`
- `logs`
- `env`
- `help`
- `export`
- `preview`

**Step 4: Final commit if any fixups needed**

```bash
git add -A
git commit -m "fix: address build/test issues from UX features"
```

Only commit if there are actual changes. If the build and tests passed cleanly in previous tasks, skip this.
