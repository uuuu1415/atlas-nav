import assert from 'node:assert/strict';
import test from 'node:test';
import { databaseConfig } from '../lib/database-config.js';
import { validateSetupInput } from '../lib/setup-config.js';
import { assertRepository, repositoryMethods } from '../lib/repository-contract.js';

test('database configuration validates every provider', () => {
  assert.deepEqual(databaseConfig({}), { provider: 'sqlite', path: './data/atlas-nav.db' });
  assert.deepEqual(databaseConfig({ DB_PROVIDER: 'POSTGRESQL', DATABASE_URL: 'postgres://localhost/atlas' }), { provider: 'postgresql', url: 'postgres://localhost/atlas' });
  assert.deepEqual(databaseConfig({ DB_PROVIDER: 'mysql', DATABASE_URL: 'mysql://localhost/atlas' }), { provider: 'mysql', url: 'mysql://localhost/atlas' });
  assert.deepEqual(databaseConfig({ DB_PROVIDER: 'mongodb', MONGODB_URI: 'mongodb://localhost:27017', MONGODB_DATABASE: 'atlas' }), { provider: 'mongodb', uri: 'mongodb://localhost:27017', database: 'atlas' });
  assert.throws(() => databaseConfig({ DB_PROVIDER: 'postgresql' }), /DATABASE_URL is required/);
  assert.throws(() => databaseConfig({ DB_PROVIDER: 'mysql', DATABASE_URL: 'postgres://localhost/atlas' }), /must use mysql:/);
  assert.throws(() => databaseConfig({ DB_PROVIDER: 'mongodb', MONGODB_URI: 'mongodb:\/\/localhost' }), /MONGODB_DATABASE is required/);
  assert.throws(() => databaseConfig({ DB_PROVIDER: 'oracle' }), /DB_PROVIDER must be one of/);
});

test('repository contract rejects incomplete adapters', () => {
  const repository = Object.fromEntries(repositoryMethods.map(method => [method, () => {}]));
  assert.equal(assertRepository(repository, 'test'), repository);
  delete repository.importData;
  assert.throws(() => assertRepository(repository, 'test'), /importData/);
});

test('setup configuration validates provider-specific fields', () => {
  assert.deepEqual(validateSetupInput({ provider: 'sqlite', sqlitePath: './data/custom.db' }), { DB_PROVIDER: 'sqlite', SQLITE_PATH: './data/custom.db' });
  assert.deepEqual(validateSetupInput({ provider: 'postgresql', host: 'db.internal', port: '5432', username: 'atlas', password: 'secret', database: 'atlas' }), { DB_PROVIDER: 'postgresql', DATABASE_URL: 'postgresql://atlas:secret@db.internal:5432/atlas' });
  assert.throws(() => validateSetupInput({ provider: 'mysql', host: 'localhost', database: 'atlas' }), /用户名、密码和数据库名/);
  assert.deepEqual(validateSetupInput({ provider: 'mongodb', mongoHost: 'localhost', mongoPort: '27017', mongoUsername: 'atlas', mongoPassword: 'secret', database: 'atlas' }), { DB_PROVIDER: 'mongodb', MONGODB_URI: 'mongodb://atlas:secret@localhost:27017', MONGODB_DATABASE: 'atlas' });
  assert.throws(() => validateSetupInput({ provider: 'mongodb', uri: 'http://localhost', database: 'atlas' }), /MongoDB URI/);
});
