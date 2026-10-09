import 'dotenv/config';
import { createMailer } from './mail.mjs';
const mailer = createMailer();
if (!mailer.ready) throw new Error(`Missing email configuration: ${mailer.missing.join(', ')}`);
try {
  await mailer.verify();
  console.log('SMTP connection and authentication succeeded. No email was sent.');
} catch {
  console.error('SMTP connection failed. Check the host, port, authentication, and TLS settings.');
  process.exitCode = 1;
}
