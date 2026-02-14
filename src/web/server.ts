import express from 'express';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { setupRoutes } from './routes/setup.js';
import { dashboardRoutes } from './routes/dashboard.js';

let onSetupComplete: (() => Promise<void>) | null = null;

export function setOnSetupComplete(fn: () => Promise<void>): void {
  onSetupComplete = fn;
}

export function getOnSetupComplete(): (() => Promise<void>) | null {
  return onSetupComplete;
}

interface PendingDownload {
  filename: string;
  data: Buffer;
  expiresAt: number;
}

const downloads = new Map<string, PendingDownload>();

export function addDownload(filename: string, data: Buffer): string {
  const id = randomUUID();
  downloads.set(id, {
    filename,
    data,
    expiresAt: Date.now() + 10 * 60 * 1000,
  });
  return id;
}

export function startWebServer(port: number = 3456): Promise<void> {
  const app = express();

  app.use(express.json({ limit: '1mb' }));

  // Serve static files from web/ directory
  app.use(express.static(join(process.cwd(), 'web')));

  // API routes
  app.use('/api/setup', setupRoutes());
  app.use('/api', dashboardRoutes());

  // Download route for large exports
  app.get('/download/:id', (req, res) => {
    const dl = downloads.get(req.params.id);
    if (!dl || Date.now() > dl.expiresAt) {
      downloads.delete(req.params.id);
      res.status(404).send('Download expired or not found.');
      return;
    }
    res.setHeader('Content-Disposition', `attachment; filename="${dl.filename}"`);
    res.setHeader('Content-Type', 'application/zip');
    res.send(dl.data);
    downloads.delete(req.params.id);
  });

  // SPA fallback — serve index.html for all non-API routes
  app.get('*', (_req, res) => {
    res.sendFile(join(process.cwd(), 'web', 'index.html'));
  });

  return new Promise((resolve, reject) => {
    const server = app.listen(port, () => {
      console.log(`Web UI available at http://localhost:${port}`);
      resolve();
    });
    server.on('error', reject);
  });
}
