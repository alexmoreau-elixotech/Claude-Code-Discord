# Claude Code Assistant

A Discord bot that gives you a team of Claude Code agents. Each project gets its own Discord channel, Docker container, and persistent workspace.

Talk to Claude Code from Discord. It clones repos, writes code, runs tests, commits, and pushes — all inside isolated containers.

## Quick Start

1. Install [Docker Desktop](https://www.docker.com/products/docker-desktop/) and start it
2. [Download the latest release](https://github.com/your-username/claude-code-assistant/releases) and unzip
3. Double-click `start.bat` (Windows) or run `./start.sh` (Mac/Linux)
4. Follow the setup wizard in your browser at http://localhost:3456

That's it. The wizard walks you through creating a Discord bot and configuring everything.

## How It Works

```
Docker Compose
├── App container (bot + web UI on port 3456)
│   ├── Discord bot
│   ├── Setup wizard / Dashboard
│   └── Docker socket → manages project containers
└── Project containers (one per project)
    └── Claude Code CLI + workspace volume
```

- `/new-project <name>` creates a channel + container under a **Claude Projects** category
- Chat in the channel — each message spawns a **thread** so the channel stays clean
- Claude has full access to the container: shell, git, browser testing
- Questions from Claude show up as **interactive buttons**
- Results appear as **rich embeds** with color coding (green = success, red = error)
- Your original message gets a reaction: hourglass while working, checkmark or cross when done
- Context overflow is handled automatically (session restarts seamlessly)

## Features

- **Per-project isolation** — each project runs in its own Docker container
- **Persistent workspaces** — Docker volumes survive restarts and rebuilds
- **Threads per task** — each message creates a thread, keeping the channel clean
- **Rich embeds** — results displayed as colored embeds, not plain text
- **Reaction status** — hourglass while working, checkmark/cross when done
- **Interactive questions** — Claude's questions show as clickable buttons
- **Multi-user support** — authorize by user ID or Discord role
- **Channel topics** — auto-updated with last activity timestamp
- **Follow-up messages** — send messages while Claude is still working
- **Headless Chrome** — Playwright pre-installed for browser testing
- **MCP servers** — Playwright and GitHub MCP servers pre-installed
- **Git identity** — configure name/email for commits inside containers
- **Base instructions** — mount a CLAUDE.md file into every container
- **Per-project env vars** — `/env set KEY VALUE` adds env vars and recreates the container
- **Auto-recovery** — context overflow silently restarts the session and retries
- **Web-based setup wizard** — guided configuration through a browser UI
- **Docker Compose deployment** — single command to start everything

## Discord Commands

| Command | Description |
|---------|-------------|
| `/new-project <name>` | Create a new project (channel + container) |
| `/delete-project` | Delete the project in the current channel |
| `/status` | Show container status |
| `/restart` | Restart the Claude session (fresh conversation) |
| `/env set <key> <value>` | Set an environment variable (recreates container) |
| `/env remove <key>` | Remove an environment variable |
| `/env list` | List project environment variables |

## Architecture

```
Docker Compose
├── App container (bot + web UI on port 3456)
│   ├── Discord bot
│   ├── Setup wizard / Dashboard
│   └── Docker socket → manages project containers
└── Project containers (one per project)
    └── Claude Code CLI + workspace volume

src/
  index.ts              # Entry point
  bot/
    client.ts            # Discord message handling, session lifecycle
    commands.ts          # Slash command registration and handlers
    formatter.ts         # Discord message formatting (truncation, attachments)
  bridge/
    session.ts           # Claude Code CLI bridge (stream-json protocol)
  config/
    types.ts             # TypeScript types and env loading
    store.ts             # Project config persistence (JSON file)
  container/
    manager.ts           # Docker container lifecycle (create, remove, exec)
  web/
    server.ts            # Web UI and setup wizard (port 3456)
Dockerfile               # Container image (Ubuntu + Node + Claude Code + Playwright)
docker-compose.yml       # Orchestrates app + project containers
```

## How Claude Code Runs

The bot spawns `claude --print --output-format stream-json --input-format stream-json` inside each container via `docker exec`. Messages are piped through stdin/stdout. The session stays alive across multiple messages, and if context overflows, it silently restarts and retries the last message.

## Why `--dangerously-skip-permissions`?

Claude Code normally asks for permission before running shell commands, editing files, or installing packages. That makes sense on your local machine — but here, Claude runs inside a disposable Docker container with no access to your host system.

Skipping permissions is what makes this useful. Claude can autonomously clone repos, install dependencies, run tests, write code, and commit — without you approving every single `npm install` or `git commit`. The container *is* the sandbox.

<details>
<summary><strong>Advanced Setup (Manual)</strong></summary>

If you prefer to set things up manually instead of using the setup wizard:

### Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) running
- [Node.js](https://nodejs.org/) 18+
- A Discord bot token ([create one here](https://discord.com/developers/applications))
- An [Anthropic API key](https://console.anthropic.com/) configured in your `~/.claude` directory

### Setup

1. **Clone the repo**

   ```bash
   git clone https://github.com/your-username/claude-code-assistant.git
   cd claude-code-assistant
   ```

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Configure environment**

   ```bash
   cp .env.example .env
   ```

   Edit `.env` with your values:

   ```env
   DISCORD_TOKEN=your-bot-token
   DISCORD_GUILD_ID=your-server-id
   DISCORD_USER_ID=your-discord-user-id
   CLAUDE_HOME=/path/to/your/.claude
   ```

   `CLAUDE_HOME` should point to your `~/.claude` directory (where your Anthropic API key and settings live).

   For **team use**, set `DISCORD_ROLE_ID` instead of (or in addition to) `DISCORD_USER_ID`. Anyone with that role can use the bot.

4. **Build and start**

   ```bash
   npm run build
   npm start
   ```

   On first run, the Docker image is built automatically.

5. **Invite the bot** to your Discord server with the `applications.commands` and `bot` scopes, and these bot permissions: Send Messages, Manage Channels, Read Message History, Attach Files, Add Reactions, Manage Messages, Create Public Threads.

### Optional Configuration

All optional — add to `.env` as needed:

| Variable | Description |
|----------|-------------|
| `DISCORD_ROLE_ID` | Discord role ID — anyone with this role can use the bot |
| `GH_TOKEN` | GitHub PAT for `gh` CLI and git auth inside containers |
| `SSH_PATH` | Path to your `.ssh` directory (mounted into containers) |
| `GITCONFIG_PATH` | Path to your `.gitconfig` |
| `GIT_USER_NAME` | Git author name for commits inside containers |
| `GIT_USER_EMAIL` | Git author email for commits inside containers |
| `CLAUDE_MD_PATH` | Path to a `CLAUDE.md` file (base instructions for every Claude session) |

</details>

## License

MIT
