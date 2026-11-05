import 'dotenv/config';
import { createApp } from './app.mjs';
import { connectDatabase } from './database.mjs';
import { initializePolicy, seedDemo, ensureDemoAccounts } from './seed.mjs';
import { Claim, User, Session, Policy } from './models.mjs';
import { readConfig } from './config.mjs';

const config = readConfig();
const demo = process.env.DEMO_MODE === 'true' && !config.production;
const database = await connectDatabase();
await Promise.all(
  [Claim, User, Session, Policy].map(
    /* Create model indexes before accepting requests. */ (model) => model.init(),
  ),
);
await initializePolicy();
if (
  (demo && database.local) ||
  (process.env.SEED_DEMO === 'true' && process.env.NODE_ENV !== 'production')
)
  await seedDemo(database.local);
if (demo) await ensureDemoAccounts();
const app = createApp({ ...config, demo });
const server = app.listen(
  config.port,
  config.host,
  /* Print the API address after listening begins. */ () =>
    console.log(`Nemo API listening on ${config.host}:${config.port}`),
);
let closing = false;
/** Stop accepting requests, close idle connections, and release MongoDB before exiting. */
async function close() {
  if (closing) return;
  closing = true;
  const deadline = setTimeout(
    /* Exit if graceful shutdown exceeds its deadline. */ () => process.exit(1),
    15000,
  ).unref();
  server.close(
    /* Close MongoDB after HTTP requests finish and then exit. */ async () => {
      await database.close();
      clearTimeout(deadline);
      process.exit(0);
    },
  );
  server.closeIdleConnections();
}
process.on('SIGINT', close);
process.on('SIGTERM', close);
