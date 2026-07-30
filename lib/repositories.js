import { sqlite } from './sqlite.js';

// Every provider must implement this same repository contract. SQLite is fully
// implemented for local use; PostgreSQL, MySQL and MongoDB can be added without
// changing routes, page code, or validation.
const provider = (process.env.DB_PROVIDER || 'sqlite').toLowerCase();
if (provider !== 'sqlite') {
  throw new Error(`DB_PROVIDER=${provider} is reserved but not implemented yet. Use sqlite for this release. See README for the adapter contract.`);
}
export const repo = sqlite;
