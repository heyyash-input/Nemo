import nodemailer from 'nodemailer';

export function createMailer(env = process.env) {
  const required = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_FROM', 'OTP_SECRET'];
  const missing = required.filter(key => !env[key]?.trim());
  if (missing.length) return { ready: false, missing };
  if (env.OTP_SECRET.length < 32) throw new Error('OTP_SECRET must contain at least 32 characters.');
  const port = Number(env.SMTP_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('SMTP_PORT is invalid.');
  if (!['true', 'false'].includes(env.SMTP_SECURE || 'false')) throw new Error('SMTP_SECURE must be true or false.');
  const secure = env.SMTP_SECURE === 'true';
  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST, port, secure,
    requireTLS: !secure,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 20000,
    disableFileAccess: true, disableUrlAccess: true,
    logger: false, debug: false,
  });
  return {
    ready: true,
    verify: () => transport.verify(),
    async sendOtp(email, code) {
      const result = await transport.sendMail({
        from: env.SMTP_FROM,
        to: { address: email, name: '' },
        subject: 'Verify your Nemo email address',
        text: `Your Nemo verification code is ${code}.\n\nThis code expires in 10 minutes and can be used once. Enter it in the signup window where you requested it.\n\nIf you did not request this code, ignore this email.`,
      });
      if (!result.accepted?.length) throw new Error('Recipient was not accepted by SMTP.');
    },
  };
}
