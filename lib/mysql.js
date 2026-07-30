import mysql from 'mysql2/promise';
import { createRelationalRepository } from './relational.js';

const schema = [
  'CREATE TABLE IF NOT EXISTS admins (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, username VARCHAR(255) UNIQUE NOT NULL, password_hash TEXT NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)',
  "CREATE TABLE IF NOT EXISTS categories (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, name TEXT NOT NULL, description TEXT, icon TEXT, color VARCHAR(32) DEFAULT '#5271ff', sort_order INT NOT NULL DEFAULT 0, visible TINYINT NOT NULL DEFAULT 1, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)",
  "CREATE TABLE IF NOT EXISTS links (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, category_id BIGINT UNSIGNED NOT NULL, name TEXT NOT NULL, url TEXT NOT NULL, description TEXT, aliases TEXT, icon_type VARCHAR(32) NOT NULL DEFAULT 'initial', icon_value TEXT, color VARCHAR(32) DEFAULT '#5271ff', sort_order INT NOT NULL DEFAULT 0, pinned TINYINT NOT NULL DEFAULT 0, visible TINYINT NOT NULL DEFAULT 1, health_status VARCHAR(64) DEFAULT 'unknown', health_checked_at TIMESTAMP NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT fk_links_category FOREIGN KEY(category_id) REFERENCES categories(id) ON DELETE CASCADE)",
  'CREATE TABLE IF NOT EXISTS login_attempts (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, username TEXT, attempted_at BIGINT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS settings (key_name VARCHAR(255) PRIMARY KEY, value TEXT NOT NULL)',
  "CREATE TABLE IF NOT EXISTS search_engines (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, name TEXT NOT NULL, query_url TEXT NOT NULL, icon TEXT, color VARCHAR(32) DEFAULT '#5271ff', sort_order INT NOT NULL DEFAULT 0, visible TINYINT NOT NULL DEFAULT 1, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)",
];

export async function createMysql(config) {
  const pool = mysql.createPool(config.url);
  const query = async (sql, values = [], connection = pool) => {
    const [result] = await connection.execute(sql, values);
    return {
      rows: Array.isArray(result) ? result : [],
      insertId: result.insertId,
    };
  };
  const transaction = async (fn) => {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const result = await fn((sql, values) => query(sql, values, connection));
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  };
  try {
    const repository = await createRelationalRepository({
      dialect: 'mysql',
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
