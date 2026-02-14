import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import express from 'express';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import http from 'http';

// Use a temp directory for test data — must be set BEFORE importing modules
// that read DATA_DIR at load time (config-file.ts, store.ts).
const TEST_DATA_DIR = join(process.cwd(), 'test-data');
process.env.DATA_DIR = TEST_DATA_DIR;

// Now import application modules (they pick up DATA_DIR from env)
const { setupRoutes } = await import('../src/web/routes/setup.js');
const { dashboardRoutes } = await import('../src/web/routes/dashboard.js');

// Helper to make HTTP requests to the test server
async function request(
  server: http.Server,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: unknown }> {
  const address = server.address() as { port: number };
  const url = `http://localhost:${address.port}${path}`;

  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json();
  return { status: res.status, body: data };
}

describe('Setup API', () => {
  let server: http.Server;

  before(() => {
    // Clean test data directory
    if (existsSync(TEST_DATA_DIR)) {
      rmSync(TEST_DATA_DIR, { recursive: true });
    }
    mkdirSync(TEST_DATA_DIR, { recursive: true });

    // Create test Express app
    const app = express();
    app.use(express.json());
    app.use('/api/setup', setupRoutes());
    app.use('/api', dashboardRoutes());

    return new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve()); // random port
    });
  });

  after(() => {
    server.close();
    if (existsSync(TEST_DATA_DIR)) {
      rmSync(TEST_DATA_DIR, { recursive: true });
    }
  });

  // ── Setup status ──────────────────────────────────────────────────────

  it('GET /api/setup/status returns setupComplete: false initially', async () => {
    const res = await request(server, 'GET', '/api/setup/status');
    assert.strictEqual(res.status, 200);
    assert.strictEqual((res.body as any).setupComplete, false);
  });

  // ── Validate token ────────────────────────────────────────────────────

  it('POST /api/setup/validate-token rejects missing token', async () => {
    const res = await request(server, 'POST', '/api/setup/validate-token', {});
    assert.strictEqual(res.status, 400);
    assert.strictEqual((res.body as any).error, 'Token is required');
  });

  it('POST /api/setup/validate-token rejects invalid token', async () => {
    const res = await request(server, 'POST', '/api/setup/validate-token', {
      token: 'invalid-token',
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual((res.body as any).valid, false);
  });

  // ── Guilds ────────────────────────────────────────────────────────────

  it('POST /api/setup/guilds rejects missing token', async () => {
    const res = await request(server, 'POST', '/api/setup/guilds', {});
    assert.strictEqual(res.status, 400);
  });

  // ── Guild roles ───────────────────────────────────────────────────────

  it('POST /api/setup/guild-roles rejects missing fields', async () => {
    const res = await request(server, 'POST', '/api/setup/guild-roles', {});
    assert.strictEqual(res.status, 400);
  });

  // ── Invite URL ────────────────────────────────────────────────────────

  it('POST /api/setup/invite-url generates correct URL', async () => {
    const res = await request(server, 'POST', '/api/setup/invite-url', {
      appId: '123456789',
    });
    assert.strictEqual(res.status, 200);
    const url = (res.body as any).url;
    assert.ok(url.includes('client_id=123456789'));
    assert.ok(url.includes('discord.com'));
    assert.ok(url.includes('permissions='));
    assert.ok(url.includes('scope=bot'));
  });

  it('POST /api/setup/invite-url rejects missing appId', async () => {
    const res = await request(server, 'POST', '/api/setup/invite-url', {});
    assert.strictEqual(res.status, 400);
  });

  // ── Save config ───────────────────────────────────────────────────────

  it('POST /api/setup/save rejects incomplete config', async () => {
    const res = await request(server, 'POST', '/api/setup/save', {
      discord: { token: 'test' },
    });
    assert.strictEqual(res.status, 400);
  });

  it('POST /api/setup/save rejects config without userId or roleId', async () => {
    const res = await request(server, 'POST', '/api/setup/save', {
      discord: { token: 'test', guildId: '123' },
    });
    assert.strictEqual(res.status, 400);
  });

  it('POST /api/setup/save accepts valid config', async () => {
    const res = await request(server, 'POST', '/api/setup/save', {
      discord: { token: 'test-token', guildId: '123', userId: '456' },
      setupComplete: false, // will be set to true by handler
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual((res.body as any).success, true);
  });

  // ── Post-save checks ─────────────────────────────────────────────────

  it('GET /api/setup/status returns setupComplete: true after save', async () => {
    const res = await request(server, 'GET', '/api/setup/status');
    assert.strictEqual(res.status, 200);
    assert.strictEqual((res.body as any).setupComplete, true);
  });

  it('GET /api/status returns dashboard data after setup', async () => {
    const res = await request(server, 'GET', '/api/status');
    assert.strictEqual(res.status, 200);
    assert.strictEqual((res.body as any).setupComplete, true);
    assert.ok(Array.isArray((res.body as any).projects));
  });

  it('GET /api/config returns redacted config', async () => {
    const res = await request(server, 'GET', '/api/config');
    assert.strictEqual(res.status, 200);
    assert.strictEqual((res.body as any).discord.hasToken, true);
    assert.strictEqual((res.body as any).discord.guildId, '123');
    // Token should NOT be present
    assert.strictEqual((res.body as any).discord.token, undefined);
  });
});
