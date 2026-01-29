# Discord Claude Code Bot - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a Discord bot that routes messages to Claude Code sessions running in Docker containers, one channel per project.

**Architecture:** Discord bot (Node.js + discord.js) manages project channels, each mapped to a Docker container running Claude Code CLI via `--print --output-format stream-json --input-format stream-json --verbose --dangerously-skip-permissions`. A session bridge pipes messages between Discord and the CLI process using NDJSON protocol.

**Tech Stack:** Node.js, TypeScript, discord.js v14, dockerode, Docker

---

### Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `src/index.ts` (placeholder)

**Step 1: Initialize the Node.js project**

```bash
cd "d:/Alex/Documents/Alexandre Moreau Inc/claude-code-assistant"
npm init -y
```

**Step 2: Install dependencies**

```bash
npm install discord.js dockerode dotenv
npm install -D typescript @types/node @types/dockerode ts-node
```

**Step 3: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

**Step 4: Create .gitignore**

```
node_modules/
dist/
.env
data/projects.json
```

**Step 5: Create .env.example**

```
DISCORD_TOKEN=your-bot-token-here
DISCORD_GUILD_ID=your-server-id-here
DISCORD_USER_ID=your-user-id-here
CLAUDE_HOME=/path/to/your/.claude
```

**Step 6: Create placeholder entry point**

```typescript
// src/index.ts
import 'dotenv/config';

console.log('Claude Code Assistant starting...');
```

**Step 7: Add scripts to package.json**

Add to `package.json` scripts:
```json
{
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "ts-node src/index.ts"
  }
}
```

**Step 8: Verify it runs**

Run: `npx ts-node src/index.ts`
Expected: Prints "Claude Code Assistant starting..."

**Step 9: Commit**

```bash
git add package.json tsconfig.json .gitignore .env.example src/index.ts
git commit -m "feat: scaffold project with TypeScript and dependencies"
```

---

### Task 2: TypeScript Types & Config Store

**Files:**
- Create: `src/config/types.ts`
- Create: `src/config/store.ts`
- Create: `data/` directory

**Step 1: Create types**

```typescript
// src/config/types.ts
export interface ProjectConfig {
  channelId: string;
  containerName: string;
  volumeName: string;
  createdAt: string;
}

export interface ProjectsData {
  projects: Record<string, ProjectConfig>;
}

export interface AppConfig {
  discordToken: string;
  guildId: string;
  userId: string;
  claudeHome: string;
}

export function loadAppConfig(): AppConfig {
  const discordToken = process.env.DISCORD_TOKEN;
  const guildId = process.env.DISCORD_GUILD_ID;
  const userId = process.env.DISCORD_USER_ID;
  const claudeHome = process.env.CLAUDE_HOME;

  if (!discordToken || !guildId || !userId || !claudeHome) {
    throw new Error(
      'Missing required env vars: DISCORD_TOKEN, DISCORD_GUILD_ID, DISCORD_USER_ID, CLAUDE_HOME'
    );
  }

  return { discordToken, guildId, userId, claudeHome };
}
```

**Step 2: Create config store**

```typescript
// src/config/store.ts
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { ProjectsData, ProjectConfig } from './types.js';

const DATA_DIR = join(process.cwd(), 'data');
const PROJECTS_FILE = join(DATA_DIR, 'projects.json');

function ensureDataDir(): void {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

function readProjects(): ProjectsData {
  ensureDataDir();
  if (!existsSync(PROJECTS_FILE)) {
    return { projects: {} };
  }
  const raw = readFileSync(PROJECTS_FILE, 'utf-8');
  return JSON.parse(raw) as ProjectsData;
}

function writeProjects(data: ProjectsData): void {
  ensureDataDir();
  writeFileSync(PROJECTS_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

export function getProject(name: string): ProjectConfig | undefined {
  return readProjects().projects[name];
}

export function getAllProjects(): Record<string, ProjectConfig> {
  return readProjects().projects;
}

export function getProjectByChannelId(channelId: string): { name: string; config: ProjectConfig } | undefined {
  const data = readProjects();
  for (const [name, config] of Object.entries(data.projects)) {
    if (config.channelId === channelId) {
      return { name, config };
    }
  }
  return undefined;
}

export function saveProject(name: string, config: ProjectConfig): void {
  const data = readProjects();
  data.projects[name] = config;
  writeProjects(data);
}

export function deleteProject(name: string): boolean {
  const data = readProjects();
  if (data.projects[name]) {
    delete data.projects[name];
    writeProjects(data);
    return true;
  }
  return false;
}
```

**Step 3: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add src/config/types.ts src/config/store.ts
git commit -m "feat: add TypeScript types and project config store"
```

---

### Task 3: Docker Container Manager

**Files:**
- Create: `src/container/manager.ts`

**Step 1: Implement container manager**

```typescript
// src/container/manager.ts
import Docker from 'dockerode';

const docker = new Docker();

const IMAGE_NAME = 'claude-code-assistant';

export interface ContainerInfo {
  name: string;
  state: string;
  running: boolean;
}

export async function buildImage(dockerfilePath: string): Promise<void> {
  const stream = await docker.buildImage(
    { context: dockerfilePath, src: ['Dockerfile'] },
    { t: IMAGE_NAME }
  );
  await new Promise<void>((resolve, reject) => {
    docker.modem.followProgress(stream, (err: Error | null) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

export async function createContainer(
  projectName: string,
  claudeHome: string
): Promise<{ containerName: string; volumeName: string }> {
  const containerName = `claude-project-${projectName}`;
  const volumeName = `claude-vol-${projectName}`;

  // Create volume if it doesn't exist
  try {
    await docker.getVolume(volumeName).inspect();
  } catch {
    await docker.createVolume({ Name: volumeName });
  }

  const container = await docker.createContainer({
    Image: IMAGE_NAME,
    name: containerName,
    Tty: false,
    OpenStdin: true,
    StdinOnce: false,
    Cmd: ['/bin/bash', '-c', 'sleep infinity'],
    WorkingDir: '/workspace',
    HostConfig: {
      Binds: [
        `${volumeName}:/workspace`,
        `${claudeHome}:/home/user/.claude:ro`,
      ],
      RestartPolicy: { Name: 'unless-stopped' },
    },
  });

  await container.start();
  return { containerName, volumeName };
}

export async function removeContainer(containerName: string, volumeName: string): Promise<void> {
  try {
    const container = docker.getContainer(containerName);
    const info = await container.inspect();
    if (info.State.Running) {
      await container.stop();
    }
    await container.remove();
  } catch {
    // Container may already be gone
  }

  try {
    await docker.getVolume(volumeName).remove();
  } catch {
    // Volume may already be gone
  }
}

export async function getContainerStatus(containerName: string): Promise<ContainerInfo | null> {
  try {
    const container = docker.getContainer(containerName);
    const info = await container.inspect();
    return {
      name: containerName,
      state: info.State.Status,
      running: info.State.Running,
    };
  } catch {
    return null;
  }
}

export async function ensureContainerRunning(containerName: string): Promise<boolean> {
  try {
    const container = docker.getContainer(containerName);
    const info = await container.inspect();
    if (!info.State.Running) {
      await container.start();
    }
    return true;
  } catch {
    return false;
  }
}

export async function execInContainer(
  containerName: string,
  cmd: string[]
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const container = docker.getContainer(containerName);
  const exec = await container.exec({
    Cmd: cmd,
    AttachStdout: true,
    AttachStderr: true,
    AttachStdin: false,
  });

  const stream = await exec.start({ hijack: true, stdin: false });

  return new Promise((resolve, reject) => {
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    // Docker multiplexes stdout/stderr via a header protocol
    docker.modem.demuxStream(stream, {
      write: (chunk: Buffer) => stdoutChunks.push(chunk),
    } as NodeJS.WritableStream, {
      write: (chunk: Buffer) => stderrChunks.push(chunk),
    } as NodeJS.WritableStream);

    stream.on('end', async () => {
      const inspectData = await exec.inspect();
      resolve({
        stdout: Buffer.concat(stdoutChunks).toString(),
        stderr: Buffer.concat(stderrChunks).toString(),
        exitCode: inspectData.ExitCode ?? 1,
      });
    });

    stream.on('error', reject);
  });
}

export async function imageExists(): Promise<boolean> {
  try {
    await docker.getImage(IMAGE_NAME).inspect();
    return true;
  } catch {
    return false;
  }
}
```

**Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add src/container/manager.ts
git commit -m "feat: add Docker container manager with lifecycle operations"
```

---

### Task 4: Dockerfile for Claude Code Container

**Files:**
- Create: `Dockerfile`

**Step 1: Create the Dockerfile**

```dockerfile
FROM ubuntu:22.04

# Prevent interactive prompts during install
ENV DEBIAN_FRONTEND=noninteractive

# Install base tools
RUN apt-get update && apt-get install -y \
    curl \
    git \
    build-essential \
    ca-certificates \
    gnupg \
    sudo \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js (needed for Claude Code CLI)
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Install Claude Code CLI globally
RUN npm install -g @anthropic-ai/claude-code

# Create a non-root user
RUN useradd -m -s /bin/bash user \
    && echo "user ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers

USER user
WORKDIR /workspace

# Keep container alive
CMD ["sleep", "infinity"]
```

**Step 2: Verify the Dockerfile builds**

Run: `docker build -t claude-code-assistant .`
Expected: Image builds successfully (this will take a few minutes on first run)

**Step 3: Commit**

```bash
git add Dockerfile
git commit -m "feat: add Dockerfile for Claude Code container"
```

---

### Task 5: Session Bridge - Claude Code Process Management

**Files:**
- Create: `src/bridge/session.ts`

**Step 1: Implement the session bridge**

This is the core component. It spawns `docker exec` to run Claude Code inside the container, communicating via stream-json over stdin/stdout.

```typescript
// src/bridge/session.ts
import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';

export interface StreamMessage {
  type: 'system' | 'assistant' | 'result';
  subtype?: string;
  message?: {
    content: Array<{
      type: 'text' | 'tool_use';
      text?: string;
      name?: string;
      input?: Record<string, unknown>;
    }>;
  };
  result?: string;
  session_id?: string;
  is_error?: boolean;
}

export interface SessionEvents {
  message: (text: string) => void;
  toolUse: (name: string, input: Record<string, unknown>) => void;
  result: (text: string, isError: boolean) => void;
  error: (error: Error) => void;
  exit: (code: number | null) => void;
}

export class ClaudeSession extends EventEmitter {
  private process: ChildProcess | null = null;
  private containerName: string;
  private sessionId: string | null = null;
  private buffer: string = '';
  private busy: boolean = false;

  constructor(containerName: string) {
    super();
    this.containerName = containerName;
  }

  isBusy(): boolean {
    return this.busy;
  }

  isAlive(): boolean {
    return this.process !== null && this.process.exitCode === null;
  }

  start(): void {
    this.process = spawn('docker', [
      'exec', '-i',
      this.containerName,
      'claude',
      '--print',
      '--output-format', 'stream-json',
      '--input-format', 'stream-json',
      '--verbose',
      '--dangerously-skip-permissions',
    ]);

    this.process.stdout?.on('data', (data: Buffer) => {
      this.buffer += data.toString();
      this.processBuffer();
    });

    this.process.stderr?.on('data', (data: Buffer) => {
      const text = data.toString().trim();
      if (text) {
        this.emit('error', new Error(text));
      }
    });

    this.process.on('exit', (code) => {
      this.busy = false;
      this.emit('exit', code);
    });

    this.process.on('error', (err) => {
      this.busy = false;
      this.emit('error', err);
    });
  }

  sendMessage(content: string): void {
    if (!this.process || !this.process.stdin) {
      throw new Error('Session not started');
    }

    this.busy = true;

    const message = JSON.stringify({
      type: 'user',
      message: {
        role: 'user',
        content: content,
      },
      session_id: this.sessionId || 'default',
      parent_tool_use_id: null,
    });

    this.process.stdin.write(message + '\n');
  }

  stop(): void {
    if (this.process) {
      this.process.kill('SIGTERM');
      this.process = null;
      this.sessionId = null;
      this.buffer = '';
      this.busy = false;
    }
  }

  private processBuffer(): void {
    const lines = this.buffer.split('\n');
    // Keep the last incomplete line in the buffer
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const msg = JSON.parse(trimmed) as StreamMessage;
        this.handleMessage(msg);
      } catch {
        // Skip non-JSON lines (e.g., debug output)
      }
    }
  }

  private handleMessage(msg: StreamMessage): void {
    // Capture session ID from any message that has it
    if (msg.session_id && msg.session_id !== 'default') {
      this.sessionId = msg.session_id;
    }

    switch (msg.type) {
      case 'system':
        // Init and hook messages - ignore for now
        break;

      case 'assistant':
        if (msg.message?.content) {
          for (const block of msg.message.content) {
            if (block.type === 'text' && block.text) {
              this.emit('message', block.text);
            } else if (block.type === 'tool_use' && block.name) {
              this.emit('toolUse', block.name, block.input || {});
            }
          }
        }
        break;

      case 'result':
        this.busy = false;
        this.emit('result', msg.result || '', msg.is_error || false);
        break;
    }
  }
}
```

**Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add src/bridge/session.ts
git commit -m "feat: add session bridge for Claude Code stream-json communication"
```

---

### Task 6: Response Formatter

**Files:**
- Create: `src/bot/formatter.ts`

**Step 1: Implement the formatter**

```typescript
// src/bot/formatter.ts
import { AttachmentBuilder } from 'discord.js';

const MAX_INLINE_CODE_LINES = 20;
const MAX_DISCORD_MESSAGE_LENGTH = 2000;

export interface FormattedResponse {
  content: string;
  files: AttachmentBuilder[];
}

export function formatTextResponse(text: string): FormattedResponse {
  const files: AttachmentBuilder[] = [];

  // If the message fits in Discord, send as-is
  if (text.length <= MAX_DISCORD_MESSAGE_LENGTH) {
    return { content: text, files };
  }

  // Message too long - truncate and attach full version
  const truncated = text.slice(0, MAX_DISCORD_MESSAGE_LENGTH - 100);
  const attachment = new AttachmentBuilder(Buffer.from(text, 'utf-8'), {
    name: 'full-response.md',
    description: 'Full response from Claude',
  });
  files.push(attachment);

  return {
    content: truncated + '\n\n*(full response attached)*',
    files,
  };
}

export function formatToolResult(
  toolName: string,
  input: Record<string, unknown>,
  output?: string
): FormattedResponse {
  const files: AttachmentBuilder[] = [];

  let summary = '';
  switch (toolName) {
    case 'Bash': {
      const cmd = (input.command as string) || 'unknown command';
      summary = `> Ran: \`${cmd.length > 100 ? cmd.slice(0, 100) + '...' : cmd}\``;
      break;
    }
    case 'Read':
      summary = `> Read: \`${input.file_path || 'unknown'}\``;
      break;
    case 'Edit':
      summary = `> Edited: \`${input.file_path || 'unknown'}\``;
      break;
    case 'Write':
      summary = `> Created: \`${input.file_path || 'unknown'}\``;
      break;
    case 'Glob':
      summary = `> Searched files: \`${input.pattern || 'unknown'}\``;
      break;
    case 'Grep':
      summary = `> Searched code: \`${input.pattern || 'unknown'}\``;
      break;
    default:
      summary = `> Used tool: ${toolName}`;
  }

  if (output) {
    const lines = output.split('\n');
    if (lines.length <= MAX_INLINE_CODE_LINES && output.length < 1500) {
      summary += `\n\`\`\`\n${output}\n\`\`\``;
    } else {
      const attachment = new AttachmentBuilder(Buffer.from(output, 'utf-8'), {
        name: `${toolName.toLowerCase()}-output.txt`,
        description: `Output from ${toolName}`,
      });
      files.push(attachment);
      summary += `\n*(${lines.length} lines - see attached)*`;
    }
  }

  return { content: summary, files };
}

export function formatErrorResponse(error: string): FormattedResponse {
  const files: AttachmentBuilder[] = [];
  const lines = error.split('\n');

  // First line is usually the error message, rest is stack trace
  const errorMessage = lines[0] || 'Unknown error';
  let content = `**Error:** ${errorMessage}`;

  if (lines.length > 5) {
    const attachment = new AttachmentBuilder(Buffer.from(error, 'utf-8'), {
      name: 'error-details.txt',
      description: 'Full error output',
    });
    files.push(attachment);
    content += '\n*(full stack trace attached)*';
  } else if (lines.length > 1) {
    content += `\n\`\`\`\n${error}\n\`\`\``;
  }

  return { content, files };
}

export function containsQuestion(text: string): boolean {
  // Check if the text ends with a question (last non-empty line ends with ?)
  const lines = text.trim().split('\n');
  const lastLine = lines[lines.length - 1].trim();
  return lastLine.endsWith('?');
}
```

**Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add src/bot/formatter.ts
git commit -m "feat: add Discord response formatter with teammate-style output"
```

---

### Task 7: Discord Bot Client & Event Handlers

**Files:**
- Create: `src/bot/client.ts`

**Step 1: Implement the Discord client**

```typescript
// src/bot/client.ts
import {
  Client,
  GatewayIntentBits,
  Events,
  Message,
  TextChannel,
} from 'discord.js';
import { getProjectByChannelId } from '../config/store.js';
import { ensureContainerRunning } from '../container/manager.js';
import { ClaudeSession } from '../bridge/session.js';
import {
  formatTextResponse,
  formatToolResult,
  containsQuestion,
} from '../bot/formatter.js';
import { AppConfig } from '../config/types.js';

// Active sessions: channelId -> ClaudeSession
const sessions = new Map<string, ClaudeSession>();

export function createClient(config: AppConfig): Client {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  client.on(Events.MessageCreate, async (message: Message) => {
    // Ignore bot messages and messages from other users
    if (message.author.bot) return;
    if (message.author.id !== config.userId) return;

    // Check if this channel is a project channel
    const project = getProjectByChannelId(message.channelId);
    if (!project) return;

    // Ensure container is running
    const running = await ensureContainerRunning(project.config.containerName);
    if (!running) {
      await message.reply('Container is not running. Try `/restart` to fix.');
      return;
    }

    // Get or create session
    let session = sessions.get(message.channelId);
    if (!session || !session.isAlive()) {
      session = createSession(project.config.containerName, message.channelId, config, message.channel as TextChannel);
      sessions.set(message.channelId, session);
    }

    // Queue check - if session is busy, notify user
    if (session.isBusy()) {
      await message.reply('Claude is still working on the previous message. Please wait...');
      return;
    }

    // Show typing indicator
    const channel = message.channel as TextChannel;
    channel.sendTyping();
    const typingInterval = setInterval(() => channel.sendTyping(), 8000);

    // Store interval on session so we can clear it on response
    (session as any)._typingInterval = typingInterval;

    // Send message to Claude
    try {
      session.sendMessage(message.content);
    } catch (err) {
      clearInterval(typingInterval);
      await message.reply('Failed to send message to Claude. Try `/restart`.');
    }
  });

  client.on(Events.ClientReady, (c) => {
    console.log(`Bot logged in as ${c.user.tag}`);
  });

  return client;
}

function createSession(
  containerName: string,
  channelId: string,
  config: AppConfig,
  channel: TextChannel
): ClaudeSession {
  const session = new ClaudeSession(containerName);

  // Accumulate text chunks into a complete response
  let responseBuffer = '';
  let responseTimeout: NodeJS.Timeout | null = null;

  const flushResponse = async () => {
    if (!responseBuffer.trim()) return;
    const text = responseBuffer;
    responseBuffer = '';

    const mention = containsQuestion(text) ? `<@${config.userId}> ` : '';
    const formatted = formatTextResponse(mention + text);

    await channel.send({
      content: formatted.content,
      files: formatted.files,
    });
  };

  session.on('message', (text: string) => {
    responseBuffer += text;

    // Debounce: wait for more chunks before sending
    if (responseTimeout) clearTimeout(responseTimeout);
    responseTimeout = setTimeout(flushResponse, 500);
  });

  session.on('toolUse', (name: string, input: Record<string, unknown>) => {
    // Tool uses are reported when result comes back
    // For now just log that Claude is using a tool
    const formatted = formatToolResult(name, input);
    channel.send({
      content: formatted.content,
      files: formatted.files,
    });
  });

  session.on('result', async (_text: string, isError: boolean) => {
    // Clear typing indicator
    const interval = (session as any)._typingInterval;
    if (interval) clearInterval(interval);

    // Flush any remaining buffered text
    if (responseTimeout) clearTimeout(responseTimeout);
    await flushResponse();

    if (isError) {
      await channel.send('Claude encountered an error while processing.');
    }
  });

  session.on('error', (err: Error) => {
    console.error(`Session error for ${containerName}:`, err.message);
  });

  session.on('exit', async (code: number | null) => {
    const interval = (session as any)._typingInterval;
    if (interval) clearInterval(interval);

    if (code !== 0 && code !== null) {
      await channel.send('Claude session ended unexpectedly. Use `/restart` to start a new session.');
    }
    sessions.delete(channelId);
  });

  session.start();
  return session;
}

export function getSession(channelId: string): ClaudeSession | undefined {
  return sessions.get(channelId);
}

export function removeSession(channelId: string): void {
  const session = sessions.get(channelId);
  if (session) {
    session.stop();
    sessions.delete(channelId);
  }
}
```

**Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add src/bot/client.ts
git commit -m "feat: add Discord client with message routing to Claude sessions"
```

---

### Task 8: Slash Commands

**Files:**
- Create: `src/bot/commands.ts`

**Step 1: Implement slash commands**

```typescript
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
```

**Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add src/bot/commands.ts
git commit -m "feat: add slash commands for project management"
```

---

### Task 9: Wire Everything Together in index.ts

**Files:**
- Modify: `src/index.ts`

**Step 1: Update the entry point**

```typescript
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
```

**Step 2: Verify the full project compiles**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: wire up entry point with Discord client, commands, and container manager"
```

---

### Task 10: Build and Smoke Test

**Step 1: Create .env file**

Copy `.env.example` to `.env` and fill in real values:
- `DISCORD_TOKEN`: Create a bot at https://discord.com/developers/applications, enable Message Content Intent, get the bot token
- `DISCORD_GUILD_ID`: Right-click your Discord server → Copy Server ID
- `DISCORD_USER_ID`: Right-click your name in Discord → Copy User ID
- `CLAUDE_HOME`: Path to your `~/.claude` directory (e.g., `C:\Users\YourName\.claude`)

**Step 2: Build the TypeScript**

Run: `npx tsc`
Expected: Compiles with no errors, `dist/` directory created

**Step 3: Build the Docker image**

Run: `docker build -t claude-code-assistant .`
Expected: Image builds successfully

**Step 4: Run the bot**

Run: `node dist/index.js`
Expected: Bot logs in, registers commands, reconnects containers

**Step 5: Test in Discord**

1. Run `/new-project test-app` in any channel
2. Go to the created `#project-test-app` channel
3. Type "Hello, what can you do?"
4. Claude should respond in the channel
5. Run `/status` to check container status
6. Run `/restart` to reset the conversation
7. Run `/delete-project` to clean up

**Step 6: Commit any fixes**

```bash
git add -A
git commit -m "fix: address issues found during smoke testing"
```

---

### Task 11: Final cleanup and initial release commit

**Step 1: Review all files for any TODO comments or placeholder code**

Check each source file for completeness.

**Step 2: Final commit**

```bash
git add -A
git commit -m "feat: complete Discord Claude Code bot v1.0"
```

---

## Summary of Tasks

| # | Task | Files |
|---|------|-------|
| 1 | Project scaffolding | `package.json`, `tsconfig.json`, `.gitignore`, `.env.example`, `src/index.ts` |
| 2 | Types & config store | `src/config/types.ts`, `src/config/store.ts` |
| 3 | Container manager | `src/container/manager.ts` |
| 4 | Dockerfile | `Dockerfile` |
| 5 | Session bridge | `src/bridge/session.ts` |
| 6 | Response formatter | `src/bot/formatter.ts` |
| 7 | Discord client | `src/bot/client.ts` |
| 8 | Slash commands | `src/bot/commands.ts` |
| 9 | Entry point wiring | `src/index.ts` |
| 10 | Build & smoke test | All files |
| 11 | Final cleanup | All files |
