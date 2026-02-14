# Claude Code Assistant

A Discord bot that gives you a team of [Claude Code](https://docs.anthropic.com/en/docs/claude-code) agents. Each project gets its own Discord channel, Docker container, and persistent workspace.

> **What is Claude Code?** Claude Code is Anthropic's official CLI tool that lets Claude write code, run commands, and manage files. This bot brings that power into Discord so your whole team can use it.

<!-- TODO: Add a screenshot or GIF here showing a Discord conversation with Claude -->
<!-- ![Demo](docs/demo.png) -->

Talk to Claude from Discord. It clones repos, writes code, runs tests, commits, and pushes — all inside isolated containers.

> **Cost note:** Claude Code requires an [Anthropic API key](https://console.anthropic.com/) with a paid plan. Usage is billed per token — a typical coding session costs a few dollars. Light usage runs roughly $10–30/month. See [Anthropic's pricing](https://www.anthropic.com/pricing) for details.

### What can you do with it?

Just talk to Claude in your project channel. For example:

- *"Clone my repo and add a login page with email and password"*
- *"Find the bug in the checkout flow and fix it"*
- *"Write tests for the API endpoints"*
- *"Refactor the dashboard component and commit the changes"*
- *"Set up a new Express app with TypeScript and push it to GitHub"*

Claude handles the terminal, file system, git, and browser testing — you just describe what you want.

## Quick Start

**You'll need:** Windows 10+, macOS, or Linux with at least 4 GB of RAM and 2 GB of free disk space. A Discord account and an [Anthropic API key](https://console.anthropic.com/) — the setup wizard will walk you through both (~2 minutes).

1. Install [Docker Desktop](https://www.docker.com/products/docker-desktop/) and start it
2. [Download the latest release](https://github.com/alexmoreau-elixotech/Claude-Code-Discord/releases) and unzip
3. Double-click `start.bat` (Windows) or run `./start.sh` (Mac/Linux)
4. Follow the setup wizard in your browser at http://localhost:3456

That's it. The wizard walks you through creating a Discord bot and connecting your API key — no coding required.

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
- **Export project** — download your project as a zip file
- **Live preview** — preview web apps in a browser with `/preview`
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
| `/logs` | Show recent logs from the Claude session |
| `/env set <key> <value>` | Set an environment variable (recreates container) |
| `/env remove <key>` | Remove an environment variable |
| `/env list` | List project environment variables |
| `/help` | Show what you can do with Claude and example prompts |
| `/export` | Download your project as a zip file |
| `/preview [start\|stop]` | Preview your website in a browser |

## How It's Sandboxed

Claude Code normally asks for permission before running shell commands, editing files, or installing packages. That makes sense on your local machine — but here, Claude runs inside a disposable Docker container with no access to your host system.

Skipping permissions is what makes this useful. Claude can autonomously clone repos, install dependencies, run tests, write code, and commit — without you approving every single action. The container *is* the sandbox.

> **Security note:** This is designed to run locally on your own machine with your own private Discord server. If you share your server with others, only authorize people you trust — authorized users can run any command inside project containers. Also consider using a [fine-grained GitHub token](https://github.com/settings/tokens?type=beta) scoped to specific repos, and [setting a spending limit](https://console.anthropic.com/) on your Anthropic account.

<details>
<summary><strong>Architecture (for developers)</strong></summary>

### Project Structure

```
src/
  index.ts                  # Entry point
  bot/
    client.ts               # Discord message handling, session lifecycle
    commands.ts             # Slash command registration and handlers
    formatter.ts            # Discord message formatting (truncation, attachments)
  bridge/
    session.ts              # Claude Code CLI bridge (stream-json protocol)
  config/
    types.ts                # TypeScript types and env loading
    store.ts                # Project config persistence (JSON file)
    config-file.ts          # Config file reading/writing
  container/
    manager.ts              # Docker container lifecycle (create, remove, exec)
  web/
    server.ts               # Web UI server (port 3456)
    routes/
      setup.ts              # Setup wizard routes
      dashboard.ts          # Dashboard routes
Dockerfile.app              # App container image (bot + web UI)
Dockerfile.project          # Project container image (Ubuntu + Node + Claude Code + Playwright)
docker-compose.yml          # Orchestrates app + project containers
```

### How Claude Code Runs

The bot spawns `claude --print --output-format stream-json --input-format stream-json` inside each container via `docker exec`. Messages are piped through stdin/stdout. The session stays alive across multiple messages, and if context overflows, it silently restarts and retries the last message.

</details>

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Bot doesn't respond to messages | Make sure the bot has the required permissions (Send Messages, Read Message History, Manage Channels, etc.) and is in the correct server |
| "Docker is not running" error | Start Docker Desktop and wait for it to fully load before running the bot |
| Container won't start | Run `/status` to check the container state. Try `/restart` or delete and recreate the project |
| "Context overflow" or long pauses | This is normal — the bot automatically restarts the session and retries. No action needed |
| Claude says it can't access a repo | Set `GH_TOKEN` in your environment so containers have GitHub access |
| Setup wizard won't load | Make sure port 3456 isn't in use by another application |
| Bot commands don't show up in Discord | It can take up to an hour for Discord to register slash commands. Try restarting the bot |

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
   git clone https://github.com/alexmoreau-elixotech/Claude-Code-Discord.git
   cd Claude-Code-Discord
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
