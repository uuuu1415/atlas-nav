import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';

test('isolated server smoke and authentication boundary', { timeout: 30000 }, async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-nav-test-'));
  const port = 3300 + crypto.randomInt(500);
  const server = spawn(process.execPath, ['server.js'], {
    env: { ...process.env, PORT: String(port), NODE_ENV: 'test', DB_PROVIDER: 'sqlite', SQLITE_PATH: path.join(directory, 'test.db'), STORAGE_PATH: path.join(directory, 'storage'), ADMIN_USERNAME: 'test-admin', ADMIN_PASSWORD: crypto.randomBytes(18).toString('hex'), SESSION_SECRET: crypto.randomBytes(32).toString('hex') },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  server.stdout.on('data', chunk => { output += chunk; });
  server.stderr.on('data', chunk => { output += chunk; });
  try {
    const base = `http://127.0.0.1:${port}`;
    for (let attempt = 0; attempt < 40; attempt++) {
      try { if ((await fetch(base)).ok) break; } catch {}
      if (attempt === 39) assert.fail(`Server startup timed out.\n${output}`);
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    assert.equal((await fetch(base)).status, 200);
    assert.equal((await fetch(`${base}/admin`)).status, 200);
    assert.equal((await fetch(`${base}/api/admin/data`)).status, 401);
    const nav = await (await fetch(`${base}/api/nav`)).json();
    for (const key of ['settings', 'categories', 'pinned', 'searchEngines']) assert.ok(key in nav);
  } finally {
    server.kill();
    await new Promise(resolve => server.once('exit', resolve)).catch(() => {});
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
