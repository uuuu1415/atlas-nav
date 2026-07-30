import { databaseConfig } from './database-config.js';
import { assertRepository } from './repository-contract.js';

export async function createRepository() {
  const config = databaseConfig();
  if (config.provider === 'sqlite') return (await import('./sqlite.js')).sqlite;
  if (config.provider === 'postgresql')
    return (await import('./postgresql.js')).createPostgresql(config);
  if (config.provider === 'mysql')
    return (await import('./mysql.js')).createMysql(config);
  return (await import('./mongodb.js')).createMongodb(config);
}

export async function loadRepository() {
  const config = databaseConfig();
  return assertRepository(await createRepository(), config.provider);
}
