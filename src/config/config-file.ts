import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'fs';
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
  } catch (err) {
    console.error('Failed to read config file:', err);
    return false;
  }
}

export function readConfig(): SetupConfig {
  ensureDir();
  if (!existsSync(CONFIG_FILE)) {
    throw new Error(`Config file not found at ${CONFIG_FILE}. Run setup first.`);
  }
  const raw = JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'));
  if (!raw.discord?.token || !raw.discord?.guildId || typeof raw.setupComplete !== 'boolean') {
    throw new Error(`Invalid config file structure at ${CONFIG_FILE}`);
  }
  return raw as SetupConfig;
}

export function writeConfig(config: SetupConfig): void {
  ensureDir();
  const tempFile = `${CONFIG_FILE}.tmp`;
  writeFileSync(tempFile, JSON.stringify(config, null, 2), 'utf-8');
  renameSync(tempFile, CONFIG_FILE);
}

export function getConfigPath(): string {
  return CONFIG_FILE;
}
