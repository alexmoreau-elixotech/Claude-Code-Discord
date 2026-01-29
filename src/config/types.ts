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
