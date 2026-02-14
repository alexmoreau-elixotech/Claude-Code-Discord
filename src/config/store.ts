import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { ProjectsData, ProjectConfig } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DATA_DIR = process.env.DATA_DIR || join(__dirname, '..', '..', 'data');
const PROJECTS_FILE = join(DATA_DIR, 'projects.json');

function ensureDataDir(): void {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

function readProjects(): ProjectsData {
  ensureDataDir();
  if (!existsSync(PROJECTS_FILE)) {
    return { projects: {} };
  }
  const raw = readFileSync(PROJECTS_FILE, 'utf-8');
  return JSON.parse(raw) as ProjectsData;
}

function writeProjects(data: ProjectsData): void {
  ensureDataDir();
  writeFileSync(PROJECTS_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

export function getProject(name: string): ProjectConfig | undefined {
  return readProjects().projects[name];
}

export function getAllProjects(): Record<string, ProjectConfig> {
  return readProjects().projects;
}

export function getProjectByChannelId(channelId: string): { name: string; config: ProjectConfig } | undefined {
  const data = readProjects();
  for (const [name, config] of Object.entries(data.projects)) {
    if (config.channelId === channelId) {
      return { name, config };
    }
  }
  return undefined;
}

export function saveProject(name: string, config: ProjectConfig): void {
  const data = readProjects();
  data.projects[name] = config;
  writeProjects(data);
}

export function deleteProject(name: string): boolean {
  const data = readProjects();
  if (data.projects[name]) {
    delete data.projects[name];
    writeProjects(data);
    return true;
  }
  return false;
}

export function getNextPreviewPort(): number {
  const data = readProjects();
  const usedPorts = new Set<number>();
  for (const project of Object.values(data.projects)) {
    if (project.previewPort) {
      usedPorts.add(project.previewPort);
    }
  }
  let port = 4000;
  while (usedPorts.has(port)) {
    port++;
  }
  return port;
}
