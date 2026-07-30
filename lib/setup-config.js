import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
export const setupConfigPath = path.resolve(root, process.env.ATLAS_CONFIG_PATH || '.atlas-nav.config.json');
const publicRoot = path.resolve(root, 'public') + path.sep;
if (setupConfigPath.startsWith(publicRoot)) throw new Error('ATLAS_CONFIG_PATH must not be inside the public directory.');

export function readSetupConfig() {
  if (!fs.existsSync(setupConfigPath)) return null;
  const value = JSON.parse(fs.readFileSync(setupConfigPath, 'utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value) || !value.DB_PROVIDER || !value.SESSION_SECRET) throw new Error('Atlas Nav configuration is invalid or unreadable.');
  return value;
}

export function applySetupConfig(config) {
  if (!config) return;
  for (const [key, value] of Object.entries(config)) process.env[key] = String(value);
}

export function hasDatabaseConfiguration() {
  if (readSetupConfig()) return true;
  // Test processes explicitly provide an isolated database path and credentials.
  if (process.env.NODE_ENV === 'test' && process.env.DB_PROVIDER) return true;
  const provider = String(process.env.DB_PROVIDER || '').toLowerCase();
  if (provider === 'sqlite') {
    const dbPath = path.resolve(root, process.env.SQLITE_PATH || './data/atlas-nav.db');
    return fs.existsSync(dbPath);
  }
  if (provider === 'postgresql' || provider === 'mysql') return Boolean(process.env.DATABASE_URL?.trim());
  if (provider === 'mongodb') return Boolean(process.env.MONGODB_URI?.trim() && process.env.MONGODB_DATABASE?.trim());
  return false;
}

export function validateSetupInput(body) {
  const provider = String(body.provider || '').trim().toLowerCase();
  if (!['sqlite', 'postgresql', 'mysql', 'mongodb'].includes(provider)) throw new Error('请选择有效的数据库类型。');
  const clean = value => String(value ?? '').trim();
  const result = { DB_PROVIDER: provider };
  if (provider === 'sqlite') {
    const sqlitePath = clean(body.sqlitePath) || './data/atlas-nav.db';
    if (sqlitePath.includes('\0')) throw new Error('SQLite 路径无效。');
    if (process.env.NODE_ENV === 'production') {
      const resolved = path.resolve(root, sqlitePath);
      const dataRoot = path.resolve(root, 'data') + path.sep;
      if (!resolved.startsWith(dataRoot)) throw new Error('生产环境 SQLite 文件必须位于项目 data 目录内。');
    }
    result.SQLITE_PATH = sqlitePath;
  } else if (provider === 'mongodb') {
    const mongoHost = clean(body.mongoHost);
    const mongoPort = Number(body.mongoPort || 27017);
    const mongoUsername = clean(body.mongoUsername);
    const mongoPassword = clean(body.mongoPassword);
    const uri = clean(body.uri) || (mongoHost && Number.isInteger(mongoPort) && mongoPort > 0 && mongoPort < 65536
      ? `mongodb://${mongoUsername ? `${encodeURIComponent(mongoUsername)}:${encodeURIComponent(mongoPassword)}@` : ''}${mongoHost}:${mongoPort}`
      : '');
    if (!/^mongodb(?:\+srv)?:\/\/[^\s]+$/i.test(uri)) throw new Error('MongoDB URI 无效。');
    result.MONGODB_URI = uri;
    result.MONGODB_DATABASE = clean(body.database);
    if (!result.MONGODB_DATABASE) throw new Error('请填写 MongoDB 数据库名。');
  } else {
    const host = clean(body.host) || '127.0.0.1';
    const port = Number(body.port || (provider === 'postgresql' ? 5432 : 3306));
    if (!/^[a-zA-Z0-9._:-]+$/.test(host) || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error('数据库主机或端口无效。');
    result.DATABASE_URL = `${provider === 'postgresql' ? 'postgresql' : 'mysql'}://${encodeURIComponent(clean(body.username))}:${encodeURIComponent(clean(body.password))}@${host}:${port}/${encodeURIComponent(clean(body.database))}`;
    if (!clean(body.username) || !clean(body.password) || !clean(body.database)) throw new Error('请填写数据库用户名、密码和数据库名。');
  }
  return result;
}

export function writeSetupConfig(config) {
  const temporaryPath = `${setupConfigPath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporaryPath, setupConfigPath);
  try { fs.chmodSync(setupConfigPath, 0o600); } catch {}
}
