import { randomBytes } from 'node:crypto';

/** Read environment settings and reject invalid or unsafe production configuration. */
export function readConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';
  const origin = env.APP_ORIGIN || (production ? '' : 'http://127.0.0.1:5173');
  let parsed;
  try {
    parsed = new URL(origin);
  } catch {
    throw new Error('Set APP_ORIGIN to the exact website origin.');
  }
  if (parsed.origin !== origin || !['http:', 'https:'].includes(parsed.protocol))
    throw new Error('APP_ORIGIN must be an origin without a trailing slash or path.');
  if (production && parsed.protocol !== 'https:')
    throw new Error('Production requires an HTTPS APP_ORIGIN.');
  if (production && !env.MONGODB_URI) throw new Error('Production requires MONGODB_URI.');
  if (production && (env.DEMO_MODE === 'true' || env.SEED_DEMO === 'true'))
    throw new Error('Disable DEMO_MODE and SEED_DEMO in production.');
  const jwtSecret = env.JWT_SECRET || (production ? '' : randomBytes(32).toString('hex'));
  if (Buffer.byteLength(jwtSecret, 'utf8') < 32)
    throw new Error('Set JWT_SECRET to a random secret of at least 32 bytes.');
  const port = Number(env.PORT || 4000);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('PORT must be a valid port number.');
  // A trusted IP/subnet list is safer than trusting any forwarded header or hop count.
  const trustProxy = env.TRUST_PROXY?.trim()
    ? env.TRUST_PROXY.split(',').map(/* Trim each trusted proxy address. */ (v) => v.trim())
    : false;
  return {
    production,
    jwtSecret,
    origin,
    port,
    host: env.HOST || (production ? '0.0.0.0' : '127.0.0.1'),
    trustProxy,
  };
}
