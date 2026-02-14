# Easy Installer & Web Setup Wizard — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make installation a download-unzip-double-click experience with a web-based setup wizard, so non-technical users can set up the bot without touching a terminal.

**Architecture:** Everything runs in Docker Compose. One `app` container hosts both the Discord bot and a web UI (Express server on port 3456). Project containers are created via Docker socket mount. Config is stored as JSON in a Docker volume. Launcher scripts (`start.bat`/`start.sh`) run `docker compose up` and open the browser.

**Tech Stack:** TypeScript, Express, vanilla HTML/CSS/JS (no frontend framework), Docker Compose, discord.js REST API for token validation.

---

### Task 1: Restructure Docker Files

**Files:**
- Rename: `Dockerfile` → `Dockerfile.project`
- Create: `Dockerfile.app`
- Create: `docker-compose.yml`
- Modify: `src/container/manager.ts` (update image build path)

**Step 1: Rename existing Dockerfile**

```bash
git mv Dockerfile Dockerfile.project
```

This is the container image for Claude Code project containers (unchanged content).

**Step 2: Create Dockerfile.app**

```dockerfile
FROM node:20-slim

# Install Docker CLI (to manage project containers via socket)
RUN apt-get update && apt-get install -y \
    ca-certificates curl gnupg && \
    install -m 0755 -d /etc/apt/keyrings && \
    curl -fsSL https://download.docker.com/linux/debian/gpg | \
      gpg --dearmor -o /etc/apt/keyrings/docker.gpg && \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
      https://download.docker.com/linux/debian $(. /etc/os-release && echo $VERSION_CODENAME) stable" \
      > /etc/apt/sources.list.d/docker.list && \
    apt-get update && apt-get install -y docker-ce-cli && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY dist/ ./dist/
COPY web/ ./web/
COPY Dockerfile.project ./Dockerfile.project

EXPOSE 3456

CMD ["node", "dist/index.js"]
```

**Step 3: Create docker-compose.yml**

```yaml
services:
  app:
    build:
      context: .
      dockerfile: Dockerfile.app
    ports:
      - "3456:3456"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - config-data:/app/data
    restart: unless-stopped
    environment:
      - DATA_DIR=/app/data

volumes:
  config-data:
```

**Step 4: Update manager.ts image build to use Dockerfile.project**

In `src/container/manager.ts`, the `buildImage` function currently uses `Dockerfile` in the context. Update it to look for `Dockerfile.project` in the app's directory (the container image for project containers).

Change `buildImage` to:
```typescript
export async function buildImage(): Promise<void> {
  const dockerfilePath = join(__dirname, '..', '..');
  const stream = await docker.buildImage(
    { context: dockerfilePath, src: ['Dockerfile.project'] },
    { t: IMAGE_NAME }
  );
  await new Promise<void>((resolve, reject) => {
    docker.modem.followProgress(stream, (err: Error | null) => {
      if (err) reject(err);
      else resolve();
    });
  });
}
```

**Step 5: Commit**

```bash
git add -A
git commit -m "refactor: restructure Docker files for compose setup

Rename Dockerfile to Dockerfile.project (project containers).
Add Dockerfile.app (bot + web UI container).
Add docker-compose.yml for one-command startup."
```

---

### Task 2: Add JSON Config File Support

**Files:**
- Create: `src/config/config-file.ts`
- Modify: `src/config/types.ts`

**Step 1: Create config-file.ts — JSON config reader/writer**

```typescript
// src/config/config-file.ts
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

const DATA_DIR = process.env.DATA_DIR || join(process.cwd(), 'data');
const CONFIG_FILE = join(DATA_DIR, 'config.json');

export interface SetupConfig {
  discord: {
    token: string;
    guildId: string;
    userId?: string;
    roleId?: string;
  };
  github?: {
    token: string;
  };
  git?: {
    userName: string;
    userEmail: string;
  };
  claudeMd?: string;
  setupComplete: boolean;
}

function ensureDir(): void {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

export function isSetupComplete(): boolean {
  if (!existsSync(CONFIG_FILE)) return false;
  try {
    const config = readConfig();
    return config.setupComplete === true;
  } catch {
    return false;
  }
}

export function readConfig(): SetupConfig {
  ensureDir();
  if (!existsSync(CONFIG_FILE)) {
    throw new Error('Config file not found. Run setup first.');
  }
  return JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'));
}

export function writeConfig(config: SetupConfig): void {
  ensureDir();
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
}

export function getConfigPath(): string {
  return CONFIG_FILE;
}
```

**Step 2: Update types.ts to support loading from JSON config**

Add a `loadAppConfigFromFile()` function that reads from the JSON config file and returns the same `AppConfig` shape. Keep the existing `loadAppConfig()` as a fallback for env-based usage.

```typescript
export function loadAppConfigFromFile(config: SetupConfig): AppConfig {
  if (!config.discord.userId && !config.discord.roleId) {
    throw new Error('Must set userId or roleId (or both)');
  }

  return {
    discordToken: config.discord.token,
    guildId: config.discord.guildId,
    userId: config.discord.userId,
    roleId: config.discord.roleId,
    claudeHome: '/home/user/.claude',
    ghToken: config.github?.token,
    gitUserName: config.git?.userName,
    gitUserEmail: config.git?.userEmail,
  };
}
```

(Import `SetupConfig` from `./config-file.js`)

**Step 3: Commit**

```bash
git add src/config/config-file.ts src/config/types.ts
git commit -m "feat: add JSON config file support for web-based setup"
```

---

### Task 3: Add Express Web Server

**Files:**
- Create: `src/web/server.ts`
- Create: `src/web/routes/setup.ts`
- Create: `src/web/routes/dashboard.ts`
- Modify: `package.json` (add express dependency)

**Step 1: Install Express**

```bash
npm install express
npm install -D @types/express
```

**Step 2: Create the web server — src/web/server.ts**

```typescript
// src/web/server.ts
import express from 'express';
import { join } from 'path';
import { setupRoutes } from './routes/setup.js';
import { dashboardRoutes } from './routes/dashboard.js';

export function startWebServer(port: number = 3456): Promise<void> {
  const app = express();

  app.use(express.json());

  // Serve static files from web/ directory
  app.use(express.static(join(process.cwd(), 'web')));

  // API routes
  app.use('/api/setup', setupRoutes());
  app.use('/api', dashboardRoutes());

  // SPA fallback — serve index.html for all non-API routes
  app.get('*', (_req, res) => {
    res.sendFile(join(process.cwd(), 'web', 'index.html'));
  });

  return new Promise((resolve) => {
    app.listen(port, () => {
      console.log(`Web UI available at http://localhost:${port}`);
      resolve();
    });
  });
}
```

**Step 3: Create setup API routes — src/web/routes/setup.ts**

```typescript
// src/web/routes/setup.ts
import { Router } from 'express';
import { REST } from 'discord.js';
import { writeConfig, isSetupComplete, type SetupConfig } from '../../config/config-file.js';
import { imageExists, buildImage } from '../../container/manager.js';

export function setupRoutes(): Router {
  const router = Router();

  // Check if setup is already complete
  router.get('/status', (_req, res) => {
    res.json({
      setupComplete: isSetupComplete(),
      dockerAvailable: true, // We're running in Docker, so Docker CLI is available
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
    } catch (err) {
      res.status(400).json({ error: 'Failed to fetch guilds' });
    }
  });

  // List roles in a guild
  router.post('/guild-roles', async (req, res) => {
    const { token, guildId } = req.body;
    try {
      const rest = new REST({ version: '10' }).setToken(token);
      const roles = await rest.get(`/guilds/${guildId}/roles`) as Array<{ id: string; name: string; position: number }>;
      // Filter out @everyone and sort by position
      const filtered = roles
        .filter(r => r.name !== '@everyone')
        .sort((a, b) => b.position - a.position);
      res.json(filtered.map(r => ({ id: r.id, name: r.name })));
    } catch (err) {
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
```

**Step 4: Create dashboard API routes — src/web/routes/dashboard.ts**

```typescript
// src/web/routes/dashboard.ts
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
```

**Step 5: Commit**

```bash
git add package.json package-lock.json src/web/
git commit -m "feat: add Express web server with setup and dashboard API routes"
```

---

### Task 4: Update Entry Point

**Files:**
- Modify: `src/index.ts`

**Step 1: Rewrite index.ts to support both setup and running modes**

```typescript
// src/index.ts
import 'dotenv/config';
import { Events } from 'discord.js';
import { loadAppConfigFromFile } from './config/types.js';
import { createClient } from './bot/client.js';
import { registerCommands, handleCommand } from './bot/commands.js';
import { imageExists, buildImage } from './container/manager.js';
import { getAllProjects } from './config/store.js';
import { ensureContainerRunning } from './container/manager.js';
import { startWebServer } from './web/server.js';
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
}

async function main(): Promise<void> {
  console.log('Claude Code Assistant starting...');

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

// Export for use by setup API (to start bot after config is saved)
export { startBot };
```

**Step 2: Add a route to start the bot from the setup API**

In `src/web/routes/setup.ts`, after saving config, trigger bot start:

```typescript
// Add at top of setup.ts:
// import { startBot } from '../../index.js';

// In the /save handler, after writeConfig(config):
// try { await startBot(); } catch (err) { console.error('Bot start failed:', err); }
```

Note: circular import risk. Instead, use an event emitter or callback pattern. Add to `server.ts`:

```typescript
let onSetupComplete: (() => Promise<void>) | null = null;

export function setOnSetupComplete(fn: () => Promise<void>): void {
  onSetupComplete = fn;
}

export function getOnSetupComplete(): (() => Promise<void>) | null {
  return onSetupComplete;
}
```

Then in `index.ts`, after starting the web server: `setOnSetupComplete(startBot);`
And in `setup.ts` `/save` handler: call `getOnSetupComplete()?.()`.

**Step 3: Commit**

```bash
git add src/index.ts src/web/server.ts src/web/routes/setup.ts
git commit -m "feat: update entry point to support setup-first flow

Web server always starts. Bot starts only after setup is complete.
Setup API triggers bot start when config is saved."
```

---

### Task 5: Build the Setup Wizard Web UI

**Files:**
- Create: `web/index.html`
- Create: `web/styles.css`
- Create: `web/app.js`

**Step 1: Create index.html**

Single-page app with the wizard steps and dashboard. All vanilla — no framework, no build step. The HTML should contain:

- A wizard container with 5 steps (hidden/shown via JS)
- A dashboard container (shown when setup is complete)
- Step 1: Prerequisites check (Docker status)
- Step 2: Discord bot token (instructions + input + validate button)
- Step 3: Server selection (guild dropdown + role/user picker)
- Step 4: Optional settings (GitHub token, git identity, CLAUDE.md)
- Step 5: Review + Launch (summary + launch button + progress bar)
- Dashboard: bot status, project list, settings link

Keep styling clean and modern — dark theme to match Discord aesthetic. Use CSS custom properties for theming.

**Step 2: Create styles.css**

Dark theme, clean typography, card-based layout. Key elements:
- Wizard step indicators (numbered circles, active/complete states)
- Form inputs styled consistently
- Success/error states with color
- Progress bar for image build
- Responsive (works on mobile too)

**Step 3: Create app.js**

Client-side logic:
- `checkSetupStatus()` — on load, check if setup is done → show dashboard or wizard
- `validateToken()` — POST to `/api/setup/validate-token`, show bot name on success
- `loadGuilds()` — POST to `/api/setup/guilds`, populate dropdown
- `loadRoles()` — POST to `/api/setup/guild-roles`, populate role picker
- `saveConfig()` — POST to `/api/setup/save` with all collected values
- `buildImage()` — POST to `/api/setup/build-image`, poll for completion
- `loadDashboard()` — GET `/api/status`, render project list and status
- Step navigation (next/back buttons)
- Form validation before advancing steps

**Step 4: Commit**

```bash
git add web/
git commit -m "feat: add web-based setup wizard and dashboard UI"
```

---

### Task 6: Create Launcher Scripts

**Files:**
- Create: `start.bat`
- Create: `start.sh`

**Step 1: Create start.bat (Windows)**

```bat
@echo off
echo.
echo  Claude Code Assistant
echo  =====================
echo.

:: Check Docker is running
docker info >nul 2>&1
if errorlevel 1 (
    echo  Docker is not running. Please start Docker Desktop and try again.
    echo.
    pause
    exit /b 1
)

echo  Starting services...
docker compose up -d --build

if errorlevel 1 (
    echo.
    echo  Failed to start. Check Docker Desktop is running.
    pause
    exit /b 1
)

echo.
echo  Claude Code Assistant is running!
echo  Opening http://localhost:3456 ...
echo.
timeout /t 3 >nul
start http://localhost:3456
echo  To stop: docker compose down
echo.
pause
```

**Step 2: Create start.sh (Mac/Linux)**

```bash
#!/bin/bash
echo ""
echo "  Claude Code Assistant"
echo "  ====================="
echo ""

# Check Docker is running
if ! docker info >/dev/null 2>&1; then
    echo "  Docker is not running. Please start Docker Desktop and try again."
    exit 1
fi

echo "  Starting services..."
docker compose up -d --build

if [ $? -ne 0 ]; then
    echo ""
    echo "  Failed to start. Check Docker Desktop is running."
    exit 1
fi

echo ""
echo "  Claude Code Assistant is running!"
echo "  Opening http://localhost:3456 ..."
echo ""
sleep 3
open http://localhost:3456 2>/dev/null || xdg-open http://localhost:3456 2>/dev/null || echo "  Open http://localhost:3456 in your browser."
echo ""
echo "  To stop: docker compose down"
```

**Step 3: Make start.sh executable**

```bash
chmod +x start.sh
```

**Step 4: Commit**

```bash
git add start.bat start.sh
git commit -m "feat: add double-click launcher scripts for Windows and Mac/Linux"
```

---

### Task 7: Update buildImage to Work Inside Container

**Files:**
- Modify: `src/container/manager.ts`

**Step 1: Fix buildImage for running inside Docker**

When the app runs inside a Docker container, it needs to build the project image using the Docker socket. The Dockerfile.project is copied into the app container at build time. Update `buildImage` to use the correct path:

```typescript
import { join } from 'path';

export async function buildImage(): Promise<void> {
  const contextPath = join(process.cwd());
  const stream = await docker.buildImage(
    { context: contextPath, src: ['Dockerfile.project'] },
    { t: IMAGE_NAME }
  );
  await new Promise<void>((resolve, reject) => {
    docker.modem.followProgress(stream, (err: Error | null) => {
      if (err) reject(err);
      else resolve();
    });
  });
}
```

Also update `createContainer` to handle the new config structure. The `claudeHome` path is now always `/home/user/.claude` inside the container (the app container mounts it, and project containers get it from the host path that the app knows about).

Since the app container manages Docker via socket, it creates project containers on the Docker daemon — those containers mount host paths, not app-container paths. The config needs to store the host paths for SSH, gitconfig, etc.

Add host path fields to `SetupConfig`:

```typescript
// In config-file.ts, add to SetupConfig:
hostPaths?: {
  claudeHome: string;     // Host path to ~/.claude
  sshPath?: string;       // Host path to ~/.ssh
  gitconfigPath?: string; // Host path to ~/.gitconfig
};
```

**Step 2: Commit**

```bash
git add src/container/manager.ts src/config/config-file.ts
git commit -m "fix: adapt image building and container creation for Docker-in-Docker"
```

---

### Task 8: Update store.ts Data Path

**Files:**
- Modify: `src/config/store.ts`

**Step 1: Use DATA_DIR environment variable for data path**

```typescript
const DATA_DIR = process.env.DATA_DIR || join(__dirname, '..', '..', 'data');
```

Replace the current `__dirname`-based path calculation with this. This ensures data is stored in the Docker volume when running in a container.

**Step 2: Commit**

```bash
git add src/config/store.ts
git commit -m "fix: use DATA_DIR env var for project data storage"
```

---

### Task 9: Update README

**Files:**
- Modify: `README.md`

**Step 1: Rewrite Quick Start section**

Replace the current multi-step setup with:

```markdown
## Quick Start

1. Install [Docker Desktop](https://www.docker.com/products/docker-desktop/) and start it
2. [Download the latest release](https://github.com/your-username/claude-code-assistant/releases)
3. Unzip and double-click `start.bat` (Windows) or `start.sh` (Mac/Linux)
4. Follow the setup wizard in your browser

That's it. The wizard walks you through creating a Discord bot and configuring everything.
```

Keep the advanced/manual setup as a collapsible section for developers.

**Step 2: Commit**

```bash
git add README.md
git commit -m "docs: update README with simplified quick start"
```

---

### Task 10: End-to-End Testing

**Files:**
- Create: `tests/setup-api.test.ts`

**Step 1: Write integration tests for setup API**

Test the key API endpoints:
- `GET /api/setup/status` returns `{ setupComplete: false }` initially
- `POST /api/setup/validate-token` with invalid token returns `{ valid: false }`
- `POST /api/setup/save` with valid config writes config file
- `GET /api/status` returns project list after setup
- `POST /api/setup/invite-url` returns correct Discord URL

Use the built-in Node.js test runner (`node:test`) or install a lightweight test framework.

**Step 2: Run tests**

```bash
npm test
```

**Step 3: Commit**

```bash
git add tests/
git commit -m "test: add setup API integration tests"
```

---

## Implementation Order Summary

| # | Task | Depends On | Estimated Scope |
|---|------|-----------|----------------|
| 1 | Restructure Docker files | — | Small |
| 2 | JSON config file support | — | Small |
| 3 | Express web server + API | 2 | Medium |
| 4 | Update entry point | 2, 3 | Small |
| 5 | Setup wizard web UI | 3 | Large |
| 6 | Launcher scripts | 1 | Small |
| 7 | Fix buildImage for Docker-in-Docker | 1 | Small |
| 8 | Update store.ts data path | — | Tiny |
| 9 | Update README | All | Small |
| 10 | End-to-end testing | All | Medium |

Tasks 1, 2, 6, 8 can run in parallel. Tasks 3 and 7 depend on 1+2. Task 4 depends on 2+3. Task 5 depends on 3.
