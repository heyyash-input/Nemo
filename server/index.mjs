import 'dotenv/config';
import { createApp } from './app.mjs';
import { connectDatabase } from './database.mjs';
import { initializePolicy, seedDemo } from './seed.mjs';
import { Claim, User, Session, Policy, SignupChallenge } from './models.mjs';
import { createMailer } from './mail.mjs';
import { readConfig } from './config.mjs';

const config = readConfig();
const mailer = createMailer();
if (config.production && !mailer.ready) throw new Error(`Configure email signup before production startup: ${mailer.missing.join(', ')}`);
if (!mailer.ready) console.warn(`Email signup unavailable until configured: ${mailer.missing.join(', ')}`);
const database = await connectDatabase();
await Promise.all([Claim, User, Session, Policy, SignupChallenge].map(model => model.init()));
await initializePolicy();
const demo = database.local && process.env.DEMO_MODE === 'true' && !config.production;
if (demo || (process.env.SEED_DEMO === 'true' && process.env.NODE_ENV !== 'production')) await seedDemo(database.local);
const app = createApp({ ...config, demo, mailer, otpSecret: process.env.OTP_SECRET });
const server = app.listen(config.port, config.host, () => console.log(`Nemo API listening on ${config.host}:${config.port}`));
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  const deadline = setTimeout(() => process.exit(1), 15000).unref();
  server.close(async () => { await database.close(); clearTimeout(deadline); process.exit(0); });
  server.closeIdleConnections();
}
process.on('SIGINT', close);
process.on('SIGTERM', close);
