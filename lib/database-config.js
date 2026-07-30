const providers = new Set(['sqlite', 'postgresql', 'mysql', 'mongodb']);

function required(env, name, provider) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required when DB_PROVIDER=${provider}.`);
  return value;
}

function connectionUrl(value, protocols, name) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid connection URL.`);
  }
  if (!protocols.includes(parsed.protocol))
    throw new Error(`${name} must use ${protocols.join(' or ')}.`);
  return value;
}

export function databaseConfig(env = process.env) {
  const provider = (env.DB_PROVIDER || 'sqlite').trim().toLowerCase();
  if (!providers.has(provider))
    throw new Error(
      `DB_PROVIDER must be one of: ${[...providers].join(', ')}. Received: ${provider || '(empty)'}.`,
    );
  if (provider === 'sqlite')
    return { provider, path: env.SQLITE_PATH?.trim() || './data/atlas-nav.db' };
  if (provider === 'postgresql')
    return {
      provider,
      url: connectionUrl(
        required(env, 'DATABASE_URL', provider),
        ['postgres:', 'postgresql:'],
        'DATABASE_URL',
      ),
    };
  if (provider === 'mysql')
    return {
      provider,
      url: connectionUrl(
        required(env, 'DATABASE_URL', provider),
        ['mysql:'],
        'DATABASE_URL',
      ),
    };
  return {
    provider,
    uri: connectionUrl(
      required(env, 'MONGODB_URI', provider),
      ['mongodb:', 'mongodb+srv:'],
      'MONGODB_URI',
    ),
    database: required(env, 'MONGODB_DATABASE', provider),
  };
}
