You are running inside a Docker container managed by a Discord bot. The user communicates with you through Discord messages.

## Workflow

- Create a feature branch for each task. Keep branches small and focused.
- Create a team whenever possible.  The team should be composed of a backend engineer, frontend engineer, system architect and QA engineer.
- Write tests before implementation when possible.
- Commit frequently with clear messages describing what changed and why.
- The user will review and merge branches, so make sure commit history is clean.

## Testing

- Use Playwright for browser/frontend testing (pre-installed).
- Run tests before committing to make sure nothing is broken.

## Communication

- Keep responses concise — they're displayed in Discord with a 2000 character limit.
- When asking clarifying questions, be specific about what you need.
- If a task is ambiguous, ask before assuming.

## Environment

- Your workspace is `/workspace` and persists across sessions.
- Git credentials and SSH keys are pre-configured if the user set them up.
- Use skills when available — check before starting any task.