import express from 'express';
import { join } from 'path';
import { setupRoutes } from './routes/setup.js';
import { dashboardRoutes } from './routes/dashboard.js';

let onSetupComplete: (() => Promise<void>) | null = null;

export function setOnSetupComplete(fn: () => Promise<void>): void {
  onSetupComplete = fn;
}

export function getOnSetupComplete(): (() => Promise<void>) | null {
  return onSetupComplete;
}

export function startWebServer(port: number = 3456): Promise<void> {
  const app = express();

  app.use(express.json({ limit: '1mb' }));

  // Serve static files from web/ directory
  app.use(express.static(join(process.cwd(), 'web')));

  // API routes
  app.use('/api/setup', setupRoutes());
  app.use('/api', dashboardRoutes());

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
