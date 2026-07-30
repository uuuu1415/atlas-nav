import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const root = process.cwd();
const dbPath = path.resolve(root, process.env.SQLITE_PATH || './data/atlas-nav.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new DatabaseSync(dbPath);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
db.exec(`
  CREATE TABLE IF NOT EXISTS admins (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE IF NOT EXISTS categories (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, description TEXT DEFAULT '', icon TEXT DEFAULT '◌', color TEXT DEFAULT '#5271ff', sort_order INTEGER NOT NULL DEFAULT 0, visible INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE IF NOT EXISTS links (id INTEGER PRIMARY KEY AUTOINCREMENT, category_id INTEGER NOT NULL, name TEXT NOT NULL, url TEXT NOT NULL, description TEXT DEFAULT '', aliases TEXT DEFAULT '', icon_type TEXT NOT NULL DEFAULT 'initial', icon_value TEXT DEFAULT '', color TEXT DEFAULT '#5271ff', sort_order INTEGER NOT NULL DEFAULT 0, pinned INTEGER NOT NULL DEFAULT 0, visible INTEGER NOT NULL DEFAULT 1, health_status TEXT DEFAULT 'unknown', health_checked_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(category_id) REFERENCES categories(id) ON DELETE CASCADE);
  CREATE TABLE IF NOT EXISTS login_attempts (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, attempted_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS search_engines (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, query_url TEXT NOT NULL, icon TEXT DEFAULT '⌕', color TEXT DEFAULT '#5271ff', sort_order INTEGER NOT NULL DEFAULT 0, visible INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
`);
for (const migration of [
  "ALTER TABLE links ADD COLUMN aliases TEXT DEFAULT ''",
  "ALTER TABLE links ADD COLUMN health_status TEXT DEFAULT 'unknown'",
  'ALTER TABLE links ADD COLUMN health_checked_at TEXT'
]) { try { db.exec(migration); } catch { /* Existing databases already have this column. */ } }
const one = (sql, ...params) => db.prepare(sql).get(...params);
const many = (sql, ...params) => db.prepare(sql).all(...params);
const run = (sql, ...params) => db.prepare(sql).run(...params);
const transaction = fn => { db.exec('BEGIN'); try { const result = fn(); db.exec('COMMIT'); return result; } catch (error) { db.exec('ROLLBACK'); throw error; } };

export const sqlite = {
  findAdmin(username) { return one('SELECT * FROM admins WHERE username = ?', username); },
  createAdmin(username, passwordHash) { const r = run('INSERT INTO admins (username, password_hash) VALUES (?, ?)', username, passwordHash); return { lastInsertRowid: r.lastInsertRowid }; },
  getSettings() { return Object.fromEntries(many('SELECT key, value FROM settings').map(row => [row.key, row.value])); },
  setSetting(key, value) { run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value); },
  categories(includeHidden = false) { const where = includeHidden ? '' : 'WHERE c.visible = 1'; return many(`SELECT c.*, COUNT(l.id) AS link_count FROM categories c LEFT JOIN links l ON l.category_id = c.id ${where} GROUP BY c.id ORDER BY c.sort_order, c.id`); },
  category(id) { return one('SELECT * FROM categories WHERE id = ?', id); },
  createCategory(data) { const sort = one('SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM categories').next; const r = run('INSERT INTO categories (name, description, icon, color, sort_order, visible) VALUES (?, ?, ?, ?, ?, ?)', data.name, data.description, data.icon, data.color, sort, data.visible ? 1 : 0); return { lastInsertRowid: r.lastInsertRowid }; },
  updateCategory(id, data) { run('UPDATE categories SET name=?, description=?, icon=?, color=?, visible=? WHERE id=?', data.name, data.description, data.icon, data.color, data.visible ? 1 : 0, id); },
  deleteCategory(id) { transaction(() => { run('DELETE FROM links WHERE category_id = ?', id); run('DELETE FROM categories WHERE id = ?', id); }); },
  reorderCategories(ids) { transaction(() => ids.forEach((id, i) => run('UPDATE categories SET sort_order = ? WHERE id = ?', i, id))); },
  links(categoryId = null, includeHidden = false) { const parts = []; const values = []; if (categoryId) { parts.push('l.category_id = ?'); values.push(categoryId); } if (!includeHidden) parts.push('l.visible = 1 AND c.visible = 1'); const where = parts.length ? `WHERE ${parts.join(' AND ')}` : ''; return many(`SELECT l.*, c.name AS category_name FROM links l JOIN categories c ON c.id=l.category_id ${where} ORDER BY l.pinned DESC, l.sort_order, l.id`, ...values); },
  link(id) { return one('SELECT * FROM links WHERE id = ?', id); },
  createLink(data) { const sort = one('SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM links WHERE category_id = ?', data.category_id).next; const r = run('INSERT INTO links (category_id,name,url,description,aliases,icon_type,icon_value,color,sort_order,pinned,visible) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', data.category_id, data.name, data.url, data.description, data.aliases || '', data.icon_type, data.icon_value, data.color, sort, data.pinned ? 1 : 0, data.visible ? 1 : 0); return { lastInsertRowid: r.lastInsertRowid }; },
  updateLink(id, data) { run('UPDATE links SET category_id=?,name=?,url=?,description=?,aliases=?,icon_type=?,icon_value=?,color=?,pinned=?,visible=? WHERE id=?', data.category_id, data.name, data.url, data.description, data.aliases || '', data.icon_type, data.icon_value, data.color, data.pinned ? 1 : 0, data.visible ? 1 : 0, id); },
  deleteLink(id) { run('DELETE FROM links WHERE id = ?', id); },
  reorderLinks(ids) { transaction(() => ids.forEach((id, i) => run('UPDATE links SET sort_order = ? WHERE id = ?', i, id))); },
  searchEngines(includeHidden = false) { return many(`SELECT * FROM search_engines ${includeHidden ? '' : 'WHERE visible = 1'} ORDER BY sort_order, id`); },
  createSearchEngine(data) { const sort = one('SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM search_engines').next; const r = run('INSERT INTO search_engines (name, query_url, icon, color, sort_order, visible) VALUES (?, ?, ?, ?, ?, ?)', data.name, data.query_url, data.icon, data.color, sort, data.visible ? 1 : 0); return { lastInsertRowid: r.lastInsertRowid }; },
  updateSearchEngine(id, data) { run('UPDATE search_engines SET name=?, query_url=?, icon=?, color=?, visible=? WHERE id=?', data.name, data.query_url, data.icon, data.color, data.visible ? 1 : 0, id); },
  deleteSearchEngine(id) { run('DELETE FROM search_engines WHERE id = ?', id); },
  reorderSearchEngines(ids) { transaction(() => ids.forEach((id, i) => run('UPDATE search_engines SET sort_order = ? WHERE id = ?', i, id))); },
  setLinkHealth(id, status) { run("UPDATE links SET health_status=?, health_checked_at=CURRENT_TIMESTAMP WHERE id=?", status, id); },
  allAdmins() { return many('SELECT id, username, password_hash, created_at FROM admins'); },
  updateAdminPassword(username, passwordHash) { run('UPDATE admins SET password_hash=? WHERE username=?', passwordHash, username); },
  recordLoginAttempt(username) { run('INSERT INTO login_attempts (username, attempted_at) VALUES (?, ?)', username, Date.now()); },
  clearLoginAttempts(username) { run('DELETE FROM login_attempts WHERE username = ?', username); },
  recentLoginAttempts(username, after) { return one('SELECT COUNT(*) AS count FROM login_attempts WHERE username=? AND attempted_at>?', username, after).count; },
  exportData() { return { settings: this.getSettings(), categories: many('SELECT * FROM categories ORDER BY sort_order,id'), links: many('SELECT * FROM links ORDER BY sort_order,id'), searchEngines: many('SELECT * FROM search_engines ORDER BY sort_order,id') }; },
  importData(payload) { transaction(() => { run('DELETE FROM links'); run('DELETE FROM categories'); run('DELETE FROM search_engines'); run('DELETE FROM settings'); for (const [key, value] of Object.entries(payload.settings || {})) this.setSetting(key, String(value)); for (const c of payload.categories || []) run('INSERT INTO categories (id,name,description,icon,color,sort_order,visible) VALUES (?,?,?,?,?,?,?)', c.id, c.name, c.description || '', c.icon || '◌', c.color || '#5271ff', c.sort_order || 0, c.visible ? 1 : 0); for (const l of payload.links || []) run('INSERT INTO links (id,category_id,name,url,description,aliases,icon_type,icon_value,color,sort_order,pinned,visible,health_status,health_checked_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)', l.id, l.category_id, l.name, l.url, l.description || '', l.aliases || '', l.icon_type || 'initial', l.icon_value || '', l.color || '#5271ff', l.sort_order || 0, l.pinned ? 1 : 0, l.visible ? 1 : 0, l.health_status || 'unknown', l.health_checked_at || null); for (const e of payload.searchEngines || []) run('INSERT INTO search_engines (id,name,query_url,icon,color,sort_order,visible) VALUES (?,?,?,?,?,?,?)', e.id, e.name, e.query_url, e.icon || '⌕', e.color || '#5271ff', e.sort_order || 0, e.visible ? 1 : 0); }); }
};
