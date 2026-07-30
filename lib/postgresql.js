import pg from 'pg';
import { createRelationalRepository } from './relational.js';

pg.types.setTypeParser(pg.types.builtins.INT8, Number);

const schema = [
  'CREATE TABLE IF NOT EXISTS admins (id BIGSERIAL PRIMARY KEY, username VARCHAR(255) UNIQUE NOT NULL, password_hash TEXT NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)',
  "CREATE TABLE IF NOT EXISTS categories (id BIGSERIAL PRIMARY KEY, name TEXT NOT NULL, description TEXT DEFAULT '', icon TEXT DEFAULT '◌', color TEXT DEFAULT '#5271ff', sort_order INTEGER NOT NULL DEFAULT 0, visible SMALLINT NOT NULL DEFAULT 1, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)",
  "CREATE TABLE IF NOT EXISTS links (id BIGSERIAL PRIMARY KEY, category_id BIGINT NOT NULL REFERENCES categories(id) ON DELETE CASCADE, name TEXT NOT NULL, url TEXT NOT NULL, description TEXT DEFAULT '', aliases TEXT DEFAULT '', icon_type TEXT NOT NULL DEFAULT 'initial', icon_value TEXT DEFAULT '', color TEXT DEFAULT '#5271ff', sort_order INTEGER NOT NULL DEFAULT 0, pinned SMALLINT NOT NULL DEFAULT 0, visible SMALLINT NOT NULL DEFAULT 1, health_status TEXT DEFAULT 'unknown', health_checked_at TIMESTAMP, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)",
  'CREATE TABLE IF NOT EXISTS login_attempts (id BIGSERIAL PRIMARY KEY, username TEXT, attempted_at BIGINT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS settings (key_name VARCHAR(255) PRIMARY KEY, value TEXT NOT NULL)',
  "CREATE TABLE IF NOT EXISTS search_engines (id BIGSERIAL PRIMARY KEY, name TEXT NOT NULL, query_url TEXT NOT NULL, icon TEXT DEFAULT '⌕', color TEXT DEFAULT '#5271ff', sort_order INTEGER NOT NULL DEFAULT 0, visible SMALLINT NOT NULL DEFAULT 1, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)",
];

export async function createPostgresql(config) {
  const pool = new pg.Pool({ connectionString: config.url });
  const convert = (sql) => {
    let index = 0;
    return sql.replace(/\?/g, () => `$${++index}`).replace(/`key`/g, 'key');
  };
  const query = async (sql, values = [], client = pool) => {
    const result = await client.query(convert(sql), values);
    return { rows: result.rows };
  };
  const transaction = async (fn) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn((sql, values) => query(sql, values, client));
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  };
  try {
    const repository = await createRelationalRepository({
      dialect: 'postgresql',
      query,
      transaction,
      schema,
    });
    repository.close = () => pool.end();
    return repository;
  } catch (error) {
    await pool.end();
    throw error;
  }
}
