const columns = {
  category: 'name,description,icon,color,sort_order,visible',
  link: 'category_id,name,url,description,aliases,icon_type,icon_value,color,sort_order,pinned,visible',
  engine: 'name,query_url,icon,color,sort_order,visible'
};

export async function createRelationalRepository({ dialect, query, transaction, schema }) {
  for (const statement of schema) await query(statement);

  const placeholders = count => Array.from({ length: count }, () => '?').join(',');
  const insert = async (table, names, values, q = query, explicitId = false) => {
    const allNames = explicitId ? `id,${names}` : names;
    const sql = `INSERT INTO ${table} (${allNames}) VALUES (${placeholders(values.length)})${dialect === 'postgresql' ? ' RETURNING id' : ''}`;
    const result = await q(sql, values);
    return { lastInsertRowid: Number(dialect === 'postgresql' ? result.rows[0].id : result.insertId) };
  };
  const rows = async (sql, values = [], q = query) => (await q(sql, values)).rows;
  const one = async (sql, values = [], q = query) => (await rows(sql, values, q))[0];
  const run = async (sql, values = [], q = query) => { await q(sql, values); };
  const bool = value => value ? 1 : 0;

  const repo = {
    async close() {},
    async findAdmin(username) { return one('SELECT * FROM admins WHERE username = ?', [username]); },
    async createAdmin(username, passwordHash) { return insert('admins', 'username,password_hash', [username, passwordHash]); },
    async getSettings() { return Object.fromEntries((await rows('SELECT key_name AS `key`, value FROM settings')).map(row => [row.key, row.value])); },
    async setSetting(key, value) {
      const sql = dialect === 'postgresql'
        ? 'INSERT INTO settings (key_name,value) VALUES (?,?) ON CONFLICT(key_name) DO UPDATE SET value=EXCLUDED.value'
        : 'INSERT INTO settings (key_name,value) VALUES (?,?) ON DUPLICATE KEY UPDATE value=VALUES(value)';
      await run(sql, [key, value]);
    },
    async categories(includeHidden = false) { return rows(`SELECT c.*, COUNT(l.id) AS link_count FROM categories c LEFT JOIN links l ON l.category_id=c.id ${includeHidden ? '' : 'WHERE c.visible=1'} GROUP BY c.id ORDER BY c.sort_order,c.id`); },
    async category(id) { return one('SELECT * FROM categories WHERE id=?', [id]); },
    async createCategory(data) { const next = Number((await one('SELECT COALESCE(MAX(sort_order),-1)+1 AS next FROM categories')).next); return insert('categories', columns.category, [data.name, data.description, data.icon, data.color, next, bool(data.visible)]); },
    async updateCategory(id, data) { await run('UPDATE categories SET name=?,description=?,icon=?,color=?,visible=? WHERE id=?', [data.name, data.description, data.icon, data.color, bool(data.visible), id]); },
    async deleteCategory(id) { await transaction(async q => { await run('DELETE FROM links WHERE category_id=?', [id], q); await run('DELETE FROM categories WHERE id=?', [id], q); }); },
    async reorderCategories(ids) { await transaction(async q => { for (const [index, id] of ids.entries()) await run('UPDATE categories SET sort_order=? WHERE id=?', [index, id], q); }); },
    async links(categoryId = null, includeHidden = false) { const filters = []; const values = []; if (categoryId) { filters.push('l.category_id=?'); values.push(categoryId); } if (!includeHidden) filters.push('l.visible=1 AND c.visible=1'); return rows(`SELECT l.*,c.name AS category_name FROM links l JOIN categories c ON c.id=l.category_id ${filters.length ? `WHERE ${filters.join(' AND ')}` : ''} ORDER BY l.pinned DESC,l.sort_order,l.id`, values); },
    async link(id) { return one('SELECT * FROM links WHERE id=?', [id]); },
    async createLink(data) { const next = Number((await one('SELECT COALESCE(MAX(sort_order),-1)+1 AS next FROM links WHERE category_id=?', [data.category_id])).next); return insert('links', columns.link, [data.category_id, data.name, data.url, data.description, data.aliases || '', data.icon_type, data.icon_value, data.color, next, bool(data.pinned), bool(data.visible)]); },
    async updateLink(id, data) { await run('UPDATE links SET category_id=?,name=?,url=?,description=?,aliases=?,icon_type=?,icon_value=?,color=?,pinned=?,visible=? WHERE id=?', [data.category_id, data.name, data.url, data.description, data.aliases || '', data.icon_type, data.icon_value, data.color, bool(data.pinned), bool(data.visible), id]); },
    async deleteLink(id) { await run('DELETE FROM links WHERE id=?', [id]); },
    async reorderLinks(ids) { await transaction(async q => { for (const [index, id] of ids.entries()) await run('UPDATE links SET sort_order=? WHERE id=?', [index, id], q); }); },
    async searchEngines(includeHidden = false) { return rows(`SELECT * FROM search_engines ${includeHidden ? '' : 'WHERE visible=1'} ORDER BY sort_order,id`); },
    async createSearchEngine(data) { const next = Number((await one('SELECT COALESCE(MAX(sort_order),-1)+1 AS next FROM search_engines')).next); return insert('search_engines', columns.engine, [data.name, data.query_url, data.icon, data.color, next, bool(data.visible)]); },
    async updateSearchEngine(id, data) { await run('UPDATE search_engines SET name=?,query_url=?,icon=?,color=?,visible=? WHERE id=?', [data.name, data.query_url, data.icon, data.color, bool(data.visible), id]); },
    async deleteSearchEngine(id) { await run('DELETE FROM search_engines WHERE id=?', [id]); },
    async reorderSearchEngines(ids) { await transaction(async q => { for (const [index, id] of ids.entries()) await run('UPDATE search_engines SET sort_order=? WHERE id=?', [index, id], q); }); },
    async setLinkHealth(id, status) { await run('UPDATE links SET health_status=?,health_checked_at=CURRENT_TIMESTAMP WHERE id=?', [status, id]); },
    async allAdmins() { return rows('SELECT id,username,password_hash,created_at FROM admins'); },
    async updateAdminPassword(username, passwordHash) { await run('UPDATE admins SET password_hash=? WHERE username=?', [passwordHash, username]); },
    async recordLoginAttempt(username) { await run('INSERT INTO login_attempts (username,attempted_at) VALUES (?,?)', [username, Date.now()]); },
    async clearLoginAttempts(username) { await run('DELETE FROM login_attempts WHERE username=?', [username]); },
    async recentLoginAttempts(username, after) { return Number((await one('SELECT COUNT(*) AS count FROM login_attempts WHERE username=? AND attempted_at>?', [username, after])).count); },
    async exportData() { return { settings: await this.getSettings(), categories: await rows('SELECT * FROM categories ORDER BY sort_order,id'), links: await rows('SELECT * FROM links ORDER BY sort_order,id'), searchEngines: await rows('SELECT * FROM search_engines ORDER BY sort_order,id') }; },
    async importData(payload) {
      await transaction(async q => {
        await run('DELETE FROM links', [], q); await run('DELETE FROM categories', [], q); await run('DELETE FROM search_engines', [], q); await run('DELETE FROM settings', [], q);
        for (const [key, value] of Object.entries(payload.settings || {})) {
          const sql = dialect === 'postgresql' ? 'INSERT INTO settings (key_name,value) VALUES (?,?) ON CONFLICT(key_name) DO UPDATE SET value=EXCLUDED.value' : 'INSERT INTO settings (key_name,value) VALUES (?,?) ON DUPLICATE KEY UPDATE value=VALUES(value)';
          await run(sql, [key, String(value)], q);
        }
        for (const c of payload.categories || []) await insert('categories', columns.category, [c.id, c.name, c.description || '', c.icon || '◌', c.color || '#5271ff', c.sort_order || 0, bool(c.visible)], q, true);
        for (const l of payload.links || []) await insert('links', `${columns.link},health_status,health_checked_at`, [l.id, l.category_id, l.name, l.url, l.description || '', l.aliases || '', l.icon_type || 'initial', l.icon_value || '', l.color || '#5271ff', l.sort_order || 0, bool(l.pinned), bool(l.visible), l.health_status || 'unknown', l.health_checked_at || null], q, true);
        for (const e of payload.searchEngines || []) await insert('search_engines', columns.engine, [e.id, e.name, e.query_url, e.icon || '⌕', e.color || '#5271ff', e.sort_order || 0, bool(e.visible)], q, true);
        if (dialect === 'postgresql') for (const table of ['categories', 'links', 'search_engines']) await run(`SELECT setval(pg_get_serial_sequence('${table}','id'), COALESCE(MAX(id),1), MAX(id) IS NOT NULL) FROM ${table}`, [], q);
      });
    }
  };
  return repo;
}
