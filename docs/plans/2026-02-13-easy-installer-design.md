# Easy Installer & Web Setup Wizard

**Date:** 2026-02-13
**Status:** Draft
**Goal:** Make installation dead simple for non-technical users. Download, double-click, follow a web wizard.

## Current State

Setup requires: cloning a repo, installing Node.js, manually creating a Discord bot, hand-editing `.env`, building TypeScript, and starting the process. ~7 manual steps, all CLI-based.

## Target Experience

1. Download `.zip` from GitHub releases
2. Double-click `start.bat` (Windows) or `start.sh` (Mac/Linux)
3. Browser opens to `http://localhost:3456`
4. Walk through a guided web wizard (5 steps)
5. Bot is running

**Only prerequisite:** Docker Desktop installed and running.

## Architecture

### Container Layout

```
docker-compose.yml
├── app service (bot + web UI + API)
│   ├── Dockerfile.app (Node.js app)
│   ├── Express server on port 3456
│   │   ├── /api/* → setup + management API
│   │   └── /* → static web UI files
│   ├── Discord bot (starts after setup is complete)
│   └── Mounts docker.sock to manage project containers
├── volumes
│   └── config-data → /app/data (persisted config + project data)
└── project containers (created dynamically via Docker socket)
    └── Uses existing Dockerfile (renamed to Dockerfile.project)
```

### File Structure (new/changed files)

```
docker-compose.yml              NEW - orchestrates everything
Dockerfile.app                  NEW - bot + web UI container
Dockerfile → Dockerfile.project RENAME - project container image
start.bat                       NEW - Windows launcher
start.sh                        NEW - Mac/Linux launcher
src/
  web/
    server.ts                   NEW - Express server for setup UI + API
    routes/
      setup.ts                  NEW - Setup wizard API endpoints
      dashboard.ts              NEW - Dashboard API endpoints
  web-ui/
    index.html                  NEW - Setup wizard + dashboard SPA
    styles.css                  NEW - Styling
    app.js                      NEW - Client-side logic
  index.ts                      MODIFY - conditional start (setup vs running)
  config/
    types.ts                    MODIFY - load from JSON config file
    store.ts                    MODIFY - config path from volume mount
```

### Setup Wizard Steps (Web UI)

**Step 1: Prerequisites Check**
- API call checks Docker socket is accessible
- Checks if project image exists (will build if not)
- Green checkmarks for passing, red with help links for failing

**Step 2: Create Discord Bot**
- Embedded step-by-step guide with:
  - Direct link to Discord Developer Portal
  - Instructions: create app → bot → copy token
  - Paste token into input field
  - Live validation: API call tests the token, shows bot name on success
- Also extracts the Application ID from the token (for invite URL)

**Step 3: Select Server & Permissions**
- After valid token: fetches list of servers the bot is in (or shows invite link)
- User enters Guild ID or bot fetches it from server list
- Shows role dropdown for authorization (fetched from Discord API)
- Option to restrict to a specific user ID

**Step 4: Optional Settings (accordion/collapsible)**
- GitHub Personal Access Token (with link to create one)
- Git identity (name + email)
- CLAUDE.md base instructions (text area or file upload)
- SSH keys path (file picker or text input)

**Step 5: Launch**
- Summary of all settings
- "Launch" button
- Progress: building Docker image → starting bot → registering commands
- Success: shows bot invite URL, link to Discord server
- Error: shows what went wrong with retry option

### Dashboard (after setup)

Same web UI at `localhost:3456`, but shows:
- Bot status: online/offline with uptime
- Project list: name, status, last activity
- Quick actions: restart bot, view logs
- Settings: edit configuration (re-runs setup steps)

### API Endpoints

```
POST /api/setup/validate-token     → validates Discord token
GET  /api/setup/guilds             → lists servers bot can see
GET  /api/setup/guild/:id/roles    → lists roles in a server
POST /api/setup/save               → saves config, starts bot
GET  /api/status                   → bot + container status
GET  /api/projects                 → list all projects
POST /api/restart                  → restart the bot
GET  /api/config                   → current config (redacted secrets)
PUT  /api/config                   → update config
```

### Config Storage

Move from `.env` to a JSON config file stored in the Docker volume:

```json
{
  "discord": {
    "token": "...",
    "guildId": "...",
    "userId": "...",
    "roleId": "..."
  },
  "claude": {
    "homePath": "/home/user/.claude"
  },
  "github": {
    "token": "..."
  },
  "git": {
    "userName": "...",
    "userEmail": "..."
  },
  "claudeMd": "contents of CLAUDE.md or null",
  "setupComplete": true
}
```

### Launcher Scripts

**start.bat (Windows):**
```bat
@echo off
echo Starting Claude Code Assistant...
docker compose up -d --build
timeout /t 3 >nul
start http://localhost:3456
echo.
echo Claude Code Assistant is running at http://localhost:3456
echo Press Ctrl+C or close this window to keep it running in background.
pause
```

**start.sh (Mac/Linux):**
```bash
#!/bin/bash
echo "Starting Claude Code Assistant..."
docker compose up -d --build
sleep 3
open http://localhost:3456 2>/dev/null || xdg-open http://localhost:3456 2>/dev/null
echo ""
echo "Claude Code Assistant is running at http://localhost:3456"
```

### Security Considerations

- Docker socket mount gives the app container full Docker access — acceptable for self-hosted, document clearly
- Config file contains secrets (Discord token, GH token) — stored in Docker volume, not exposed to host filesystem directly
- Web UI only listens on localhost — not exposed externally
- No auth on the web UI for now (localhost only) — add basic auth as a future option

## Implementation Sequence

1. **Phase 1: Docker Compose + restructure** — Rename Dockerfile, create Dockerfile.app, docker-compose.yml, launcher scripts. Get the bot running in Docker.
2. **Phase 2: Web server + API** — Add Express server with setup and status API endpoints. Modify entry point to serve API before bot is configured.
3. **Phase 3: Setup wizard UI** — Build the web UI for the setup flow. Connect to API endpoints.
4. **Phase 4: Dashboard UI** — Add post-setup dashboard with status, projects, logs, settings.
5. **Phase 5: Polish** — Error handling, progress indicators, validation, help text, mobile-friendly CSS.
