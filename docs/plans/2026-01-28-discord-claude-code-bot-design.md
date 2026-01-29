# Discord Claude Code Bot - Design Document

## Purpose

A Discord bot that lets you interact with Claude Code through Discord channels. Each project gets its own channel and Docker container. Claude Code acts as a teammate - conversational, summarized output, details on demand.

## Architecture

Three components, all running on a single machine:

1. **Discord Bot** (Node.js + discord.js) - Handles Discord events, routes messages, formats responses
2. **Container Manager** (dockerode) - Docker container lifecycle per project
3. **Session Bridge** - Communicates with Claude Code via `--print --output-format stream-json --input-format stream-json`

### Flow

```
You (Discord) --> Bot --> Session Bridge --> Claude Code (in Docker container)
                                           |
Claude responds --> Bridge formats --> Bot posts summary + optional file attachment
```

## Container Setup

### Base Docker Image

Minimal image containing:
- Claude Code CLI installed globally
- Git, curl, common build tools
- A workspace directory at `/workspace`

No predefined toolchains. Claude Code installs what it needs dynamically based on your requests.

### Per-Project Container

- Named Docker volume at `/workspace` for persistent code
- `~/.claude/` mounted read-only for auth (Claude Max subscription)
- Container name: `claude-project-{name}`
- Claude Code runs with `--dangerously-skip-permissions` (safe inside sandbox)

### Container Lifecycle

- Created on `/new-project` slash command
- Stays running while the project exists
- Destroyed on `/delete-project`
- Reconnected automatically on bot startup

### Claude Code Process

```bash
claude --print \
  --output-format stream-json \
  --input-format stream-json \
  --dangerously-skip-permissions
```

Process stays alive for conversation duration. Messages piped to stdin, responses read from stdout. Process crash triggers automatic restart with `--continue` to resume context.

## Discord Bot Design

### Slash Commands

- `/new-project <name>` - Creates channel + container
- `/delete-project` - Stops container, optionally archives channel
- `/status` - Container status, disk usage, conversation state
- `/restart` - Restarts Claude Code process (fresh conversation)
- `/logs` - Attaches recent raw Claude Code output as a file

### Message Flow

1. You type a message in a project channel
2. Bot verifies channel is mapped to a project container
3. Message piped to Claude Code stdin as stream-json
4. Bot reads streaming response from stdout
5. Bot formats response (summary in channel, verbose output as attachments)
6. If Claude asks a clarifying question, bot @mentions you
7. Your reply gets piped back in, conversation continues

### Formatting Rules (Teammate Feel)

- Code under 20 lines: inline code block
- Code over 20 lines: file attachment
- Test results: summary line ("5/5 passed") + full output as attachment
- File changes: short description + diff as attachment if large
- Errors: highlighted error message, full stack trace as attachment

## Session Bridge

### Stream-JSON Protocol

Claude Code's stream-json format provides typed events (assistant messages, tool results, etc.), enabling:
- Distinguishing conversational text from tool output
- Detecting questions vs statements
- Separating code, file changes, and test results from prose

### Message Processing Pipeline

1. **Receive** raw stream-json events from Claude Code stdout
2. **Accumulate** until complete response formed
3. **Classify** content: text, code output, errors, questions
4. **Format** per teammate rules (summaries + attachments)
5. **Send** to Discord channel

### Question Detection

When Claude's response ends with a question, the bot adds an @mention for notification.

### Error Handling

Process crash: bot posts "Claude ran into an issue, restarting..." and spins up new process with `--continue`.

## Project Structure

```
claude-code-assistant/
├── package.json
├── Dockerfile
├── src/
│   ├── index.ts
│   ├── bot/
│   │   ├── client.ts           # Discord client setup & event handlers
│   │   ├── commands.ts         # Slash command definitions & handlers
│   │   └── formatter.ts        # Response formatting
│   ├── container/
│   │   ├── manager.ts          # Docker container lifecycle
│   │   └── image.ts            # Docker image building
│   ├── bridge/
│   │   ├── session.ts          # Claude Code process management
│   │   ├── protocol.ts         # Stream-JSON parsing
│   │   └── classifier.ts       # Content classification
│   └── config/
│       ├── store.ts            # Project config persistence
│       └── types.ts            # TypeScript types
├── data/
│   └── projects.json
└── tests/
```

## Data Model

### projects.json

```json
{
  "projects": {
    "my-app": {
      "channelId": "1234567890",
      "containerName": "claude-project-my-app",
      "volumeName": "claude-vol-my-app",
      "createdAt": "2026-01-28T00:00:00Z"
    }
  }
}
```

### Runtime State (In-Memory)

- Active Claude Code child processes per project
- Message queues (if multiple messages sent before Claude finishes)
- Container status cache

### Environment Variables (.env)

- `DISCORD_TOKEN` - Bot token
- `DISCORD_GUILD_ID` - Your server ID
- `DISCORD_USER_ID` - Your user ID (for @mentions)
- `CLAUDE_HOME` - Path to `~/.claude/` directory

## Tech Stack

- **Node.js + TypeScript**
- **discord.js** - Discord bot framework
- **dockerode** - Docker API client for Node.js

## Access Model

Single user only. Your Discord user ID is the only authorized account.
