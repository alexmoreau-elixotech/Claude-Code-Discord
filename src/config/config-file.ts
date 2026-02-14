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
