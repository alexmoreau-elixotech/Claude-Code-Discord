# Non-Programmer UX Improvements

**Date:** 2026-02-13
**Goal:** Make Claude Code Assistant usable by non-programmers through 4 features.

---

## 1. `/help` Command

Add a `/help` slash command that responds with a rich embed showing example prompts grouped by category:

- **Getting Started**: "Build me a personal website", "Create a to-do app"
- **Working with Code**: "Clone [repo] and explain what it does", "Fix the bug in index.html"
- **Files & Export**: "Show me what files are in the project", `/export`, `/preview`
- **Management**: `/status`, `/restart`, `/delete-project`

Response is ephemeral (only visible to the caller).

Additionally, when `/new-project` creates a channel, post an automatic welcome message with starter prompts so users don't face a blank channel.

**Files to modify:**
- `src/bot/commands.ts` — add `/help` command definition and handler
- `src/bot/client.ts` — add welcome message on channel creation

---

## 2. `/export` Command

Add a `/export` slash command that zips the project workspace and delivers it to the user.

**Flow:**
1. Run `zip -r /tmp/project.zip /workspace -x "node_modules/*" ".git/*" "dist/*" "__pycache__/*"` inside the container
2. Copy the zip out via `docker cp`
3. If under 25MB: upload as Discord file attachment
4. If over 25MB: serve from `localhost:3456/download/project-name.zip` with a 10-minute expiry link
5. Clean up temp files

Reply embed shows file count and total size.

**Files to modify:**
- `src/bot/commands.ts` — add `/export` command definition and handler
- `src/container/manager.ts` — add helper to copy files out of container
- `src/web/server.ts` — add `/download/:filename` route for fallback
- `src/web/routes/` — add download route handler (optional, could be inline)

---

## 3. `/preview` Command

Add a `/preview` slash command that starts a static file server inside the project container and maps a port to the host.

**Flow:**
1. Assign a port from a pool starting at 4000 (tracked per project in store)
2. Recreate the container with the port mapped (same pattern as `/env set`)
3. Start `npx serve /workspace -l 4000` inside the container
4. Reply with embed: "Your project is live at `http://localhost:4000`"

**Subcommands:**
- `/preview` (or `/preview start`) — start the preview server
- `/preview stop` — kill the server and free the port

Store preview state (port, server PID) in project config for persistence across bot restarts. Container recreation only happens on first `/preview` call; subsequent calls just start/stop the HTTP server.

**Files to modify:**
- `src/bot/commands.ts` — add `/preview` command with start/stop subcommands
- `src/container/manager.ts` — add port mapping support to container creation
- `src/config/store.ts` — add preview port/PID tracking to project config
- `src/config/types.ts` — add preview fields to ProjectConfig type

---

## 4. Friendly Error Messages

Replace technical error messages with plain language at the Discord output layer.

**Error mapping:**

| Technical Pattern | Friendly Message |
|---|---|
| Container is not running | "Claude's workspace isn't running. Use `/restart` to start it back up." |
| Context overflow / prompt too long | "The conversation got too long — Claude is starting fresh and will retry your message." |
| ECONNREFUSED / Docker socket | "Can't connect to Docker. Make sure Docker Desktop is running on your computer." |
| Session exited with code 1 | "Something went wrong. Try `/restart` to start a new conversation." |
| Image not found / build failed | "Setting up the workspace for the first time — this may take a few minutes." |
| ENOMEM / out of memory | "The project ran out of memory. Try restarting with `/restart`." |
| Permission denied | "Claude doesn't have permission to do that. This shouldn't happen — try `/restart`." |
| Unrecognized errors | "Something unexpected happened." + raw error in spoiler tag |

**Implementation:** Single `friendlyError(msg)` function that pattern-matches against known errors and returns the friendly version. Applied at the Discord output layer.

**Files to modify:**
- `src/bot/formatter.ts` — add `friendlyError()` function with pattern matching
- `src/bot/client.ts` — apply `friendlyError()` at all error output points
