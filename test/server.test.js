import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';

test(
  'isolated server smoke and authentication boundary',
  { timeout: 30000 },
  async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-nav-test-'));
    const port = 3300 + crypto.randomInt(500);
    const password = crypto.randomBytes(18).toString('hex');
    const server = spawn(process.execPath, ['server.js'], {
      env: {
        ...process.env,
        PORT: String(port),
        NODE_ENV: 'test',
        DB_PROVIDER: 'sqlite',
        SQLITE_PATH: path.join(directory, 'test.db'),
        STORAGE_PATH: path.join(directory, 'storage'),
        ADMIN_USERNAME: 'test-admin',
        ADMIN_PASSWORD: password,
        SESSION_SECRET: crypto.randomBytes(32).toString('hex'),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    server.stdout.on('data', (chunk) => {
      output += chunk;
    });
    server.stderr.on('data', (chunk) => {
      output += chunk;
    });
    try {
      const base = `http://127.0.0.1:${port}`;
      for (let attempt = 0; attempt < 40; attempt++) {
        try {
          if ((await fetch(base)).ok) break;
        } catch {}
        if (attempt === 39) assert.fail(`Server startup timed out.\n${output}`);
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      assert.equal((await fetch(base)).status, 200);
      assert.equal((await fetch(`${base}/admin`)).status, 200);
      assert.equal((await fetch(`${base}/api/admin/data`)).status, 401);
      const nav = await (await fetch(`${base}/api/nav`)).json();
      for (const key of ['settings', 'categories', 'pinned', 'searchEngines'])
        assert.ok(key in nav);

      const login = await fetch(`${base}/api/admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'test-admin', password }),
      });
      assert.equal(login.status, 200);
      const cookie = login.headers.get('set-cookie').split(';')[0];
      const headers = { Cookie: cookie, 'Content-Type': 'application/json' };
      const created = await (
        await fetch(`${base}/api/admin/categories`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            name: 'Temporary',
            description: 'test',
            visible: true,
          }),
        })
      ).json();
      assert.ok(Number.isSafeInteger(Number(created.id)));
      assert.equal(
        (
          await fetch(`${base}/api/admin/categories/${created.id}`, {
            method: 'PUT',
            headers,
            body: JSON.stringify({ name: 'Updated', visible: true }),
          })
        ).status,
        200,
      );
      const status = await (
        await fetch(`${base}/api/admin/update-status`, {
          headers: { Cookie: cookie.split(';')[0] },
        })
      ).json();
      assert.deepEqual(status, { enabled: false, available: false });
      const data = await (await fetch(`${base}/api/admin/data`, { headers })).json();
      assert.equal(
        data.categories.find((category) => Number(category.id) === Number(created.id))
          .name,
        'Updated',
      );
      const exported = await (
        await fetch(`${base}/api/admin/export`, { headers })
      ).json();
      assert.ok(
        exported.categories.some(
          (category) => Number(category.id) === Number(created.id),
        ),
      );
      assert.equal(
        (
          await fetch(`${base}/api/admin/categories/${created.id}`, {
            method: 'DELETE',
            headers,
          })
        ).status,
        200,
      );
    } finally {
      server.kill();
      await new Promise((resolve) => server.once('exit', resolve)).catch(() => {});
      fs.rmSync(directory, { recursive: true, force: true });
    }
  },
);

test(
  'first-start database setup page configures isolated SQLite',
  { timeout: 30000 },
  async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-nav-setup-'));
    const port = 3800 + crypto.randomInt(300);
    const server = spawn(process.execPath, ['server.js'], {
      env: {
        ...process.env,
        PORT: String(port),
        NODE_ENV: 'test',
        DB_PROVIDER: '',
        SQLITE_PATH: path.join(directory, 'test.db'),
        ATLAS_CONFIG_PATH: path.join(directory, 'config.json'),
        ATLAS_SETUP_TOKEN: 'setup-token',
        STORAGE_PATH: path.join(directory, 'storage'),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    try {
      const base = `http://127.0.0.1:${port}`;
      for (let attempt = 0; attempt < 40; attempt++) {
        try {
          if ((await fetch(base)).ok) break;
        } catch {}
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      assert.equal((await fetch(`${base}/`)).status, 200);
      assert.equal(
        (await (await fetch(`${base}/api/setup/status`)).json()).configured,
        false,
      );
      assert.equal(
        (
          await fetch(`${base}/api/setup/configure`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ provider: 'sqlite', setupToken: 'wrong' }),
          })
        ).status,
        403,
      );
      const setup = await fetch(`${base}/api/setup/configure`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'sqlite',
          sqlitePath: path.join(directory, 'test.db'),
          adminUsername: 'setup-admin',
          adminPassword: 'setup-password-123',
          setupToken: 'setup-token',
        }),
      });
      assert.equal(setup.status, 200);
      const persistedConfig = JSON.parse(
        fs.readFileSync(path.join(directory, 'config.json'), 'utf8'),
      );
      assert.equal('ADMIN_PASSWORD' in persistedConfig, false);
      assert.match(persistedConfig.ADMIN_PASSWORD_HASH, /^\$2[aby]\$/);
      assert.equal(
        (await (await fetch(`${base}/api/setup/status`)).json()).configured,
        true,
      );
      assert.equal((await fetch(`${base}/api/nav`)).status, 200);
    } finally {
      server.kill();
      await new Promise((resolve) => server.once('exit', resolve)).catch(() => {});
      fs.rmSync(directory, { recursive: true, force: true });
    }
  },
);

test(
  'production HTTP login keeps a usable non-Secure session cookie',
  { timeout: 30000 },
  async () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'atlas-nav-production-http-'),
    );
    const port = 4100 + crypto.randomInt(300);
    const password = crypto.randomBytes(18).toString('hex');
    const databasePath = path.join(directory, 'test.db');
    fs.closeSync(fs.openSync(databasePath, 'w'));
    const server = spawn(process.execPath, ['server.js'], {
      env: {
        ...process.env,
        PORT: String(port),
        NODE_ENV: 'production',
        DB_PROVIDER: 'sqlite',
        SQLITE_PATH: databasePath,
        STORAGE_PATH: path.join(directory, 'storage'),
        ADMIN_USERNAME: 'production-admin',
        ADMIN_PASSWORD: password,
        SESSION_SECRET: crypto.randomBytes(32).toString('hex'),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    try {
      const base = `http://127.0.0.1:${port}`;
      for (let attempt = 0; attempt < 40; attempt++) {
        try {
          if ((await fetch(base)).ok) break;
        } catch {}
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      const login = await fetch(`${base}/api/admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'production-admin', password }),
      });
      assert.equal(login.status, 200);
      const cookie = login.headers.get('set-cookie');
      assert.match(cookie, /HttpOnly/);
      assert.doesNotMatch(cookie, /(?:^|;)\s*Secure(?:;|$)/);
      assert.equal(
        (
          await fetch(`${base}/api/admin/data`, {
            headers: { Cookie: cookie.split(';')[0] },
          })
        ).status,
        200,
      );
    } finally {
      server.kill();
      await new Promise((resolve) => server.once('exit', resolve)).catch(() => {});
      fs.rmSync(directory, { recursive: true, force: true });
    }
  },
);
