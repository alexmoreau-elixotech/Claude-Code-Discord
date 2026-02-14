import { resolve } from 'path';
import { SetupConfig } from './config-file.js';

export interface ProjectConfig {
  channelId: string;
  containerName: string;
  volumeName: string;
  createdAt: string;
  envVars?: Record<string, string>;
}

export interface ProjectsData {
  projects: Record<string, ProjectConfig>;
}

export interface AppConfig {
  discordToken: string;
  guildId: string;
  userId?: string;
  roleId?: string;
  claudeHome: string;
  sshPath?: string;
  gitconfigPath?: string;
  ghToken?: string;
  claudeMdPath?: string;
  gitUserName?: string;
  gitUserEmail?: string;
}

export function loadAppConfig(): AppConfig {
  const discordToken = process.env.DISCORD_TOKEN;
  const guildId = process.env.DISCORD_GUILD_ID;
  const userId = process.env.DISCORD_USER_ID || undefined;
  const roleId = process.env.DISCORD_ROLE_ID || undefined;
  const claudeHome = process.env.CLAUDE_HOME;

  if (!discordToken || !guildId || !claudeHome) {
    throw new Error(
      'Missing required env vars: DISCORD_TOKEN, DISCORD_GUILD_ID, CLAUDE_HOME'
    );
  }
  if (!userId && !roleId) {
    throw new Error(
      'Must set DISCORD_USER_ID or DISCORD_ROLE_ID (or both)'
    );
  }

  return {
    discordToken,
    guildId,
    userId,
    roleId,
    claudeHome,
    sshPath: process.env.SSH_PATH || undefined,
    gitconfigPath: process.env.GITCONFIG_PATH || undefined,
    ghToken: process.env.GH_TOKEN || undefined,
    claudeMdPath: process.env.CLAUDE_MD_PATH ? resolve(process.env.CLAUDE_MD_PATH) : undefined,
    gitUserName: process.env.GIT_USER_NAME || undefined,
    gitUserEmail: process.env.GIT_USER_EMAIL || undefined,
  };
}

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
