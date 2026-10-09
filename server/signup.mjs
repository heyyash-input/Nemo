import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { SignupChallenge, User } from './models.mjs';

export const passwordInput = z.string().min(10).max(72).refine(value => Buffer.byteLength(value, 'utf8') <= 72, 'Password must be at most 72 UTF-8 bytes.');
const emailInput = z.string().trim().toLowerCase().pipe(z.email().max(200));
const registration = z.object({
  email: emailInput,
  name: z.string().trim().min(2).max(100),
  department: z.string().trim().min(2).max(80),
  password: passwordInput,
}).strict();
const verification = z.object({ challenge: z.string().regex(/^[a-f0-9]{64}$/), code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code.') }).strict();
const hash = value => createHash('sha256').update(value).digest('hex');
const error = (status, message) => Object.assign(new Error(message), { status });
const cooldownMs = 60000;
const expiryMs = 10 * 60000;

export function registerSignup(app, { mailer, otpSecret, allowedDomains = [], signIn }) {
  const limit = rateLimit({ windowMs: 15 * 60000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false, message: { message: 'Too many signup requests. Try again in 15 minutes.' } });
  const verifyLimit = rateLimit({ windowMs: 15 * 60000, limit: 40, standardHeaders: 'draft-8', legacyHeaders: false, message: { message: 'Too many verification attempts. Try again in 15 minutes.' } });
  const digest = (challenge, code) => createHmac('sha256', otpSecret).update(`${challenge}:${code}`).digest('hex');
  const ready = (_req, _res, next) => mailer?.ready && otpSecret?.length >= 32 ? next() : next(error(503, 'Email signup is not configured yet. Contact your administrator.'));
  async function deliver(record, challenge, code) {
    try { await mailer.sendOtp(record.email, code); }
    catch {
      // A failed send must not leave a usable verification challenge.
      await SignupChallenge.deleteOne({ _id: record._id, challengeHash: hash(challenge) });
      console.error('signup_email_delivery_failed');
      throw error(503, 'We could not send the verification email. Please try again later.');
    }
  }
  const response = (res, challenge) => res.status(202).json({ challenge, expiresInSeconds: expiryMs / 1000, resendAfterSeconds: cooldownMs / 1000, message: 'If this email can be registered, a verification code has been sent. Otherwise, sign in with your existing account.' });
  app.post('/api/auth/signup', limit, ready, async (req, res) => {
    const input = registration.parse(req.body);
    if (allowedDomains.length && !allowedDomains.includes(input.email.split('@')[1])) throw error(400, 'Use an email address from an allowed company domain.');
    if (input.email.endsWith('.demo')) throw error(400, 'Use a real email address to receive your verification code.');
    const challenge = randomBytes(32).toString('hex');
    if (await User.exists({ email: input.email })) return response(res, challenge);
    const now = new Date();
    const previous = await SignupChallenge.findOne({ email: input.email });
    if (previous && now - previous.sentAt < cooldownMs) throw error(429, 'Wait 60 seconds before requesting another code.');
    const code = String(randomInt(0, 1000000)).padStart(6, '0');
    const values = { email: input.email, name: input.name, department: input.department, passwordHash: await bcrypt.hash(input.password, 12), challengeHash: hash(challenge), otpHash: digest(challenge, code), attempts: 0, sentAt: now, expiresAt: new Date(now.getTime() + expiryMs) };
    let record;
    try {
      record = previous
        ? await SignupChallenge.findOneAndUpdate({ _id: previous._id, sentAt: previous.sentAt, challengeHash: previous.challengeHash }, { $set: values }, { new: true })
        : await SignupChallenge.create(values);
    } catch (e) {
      if (e.code === 11000) throw error(429, 'Another signup request is already in progress. Wait 60 seconds.');
      throw e;
    }
    if (!record) throw error(429, 'Another signup request is already in progress. Wait 60 seconds.');
    await deliver(record, challenge, code);
    return response(res, challenge);
  });
  app.post('/api/auth/signup/resend', limit, ready, async (req, res) => {
    const input = z.object({ challenge: verification.shape.challenge }).strict().parse(req.body);
    const challenge = randomBytes(32).toString('hex');
    const code = String(randomInt(0, 1000000)).padStart(6, '0');
    const now = new Date();
    const record = await SignupChallenge.findOneAndUpdate({ challengeHash: hash(input.challenge), sentAt: { $lte: new Date(now.getTime() - cooldownMs) }, expiresAt: { $gt: now } }, {
      $set: { challengeHash: hash(challenge), otpHash: digest(challenge, code), attempts: 0, sentAt: now, expiresAt: new Date(now.getTime() + expiryMs) },
    }, { new: true });
    if (!record) throw error(429, 'Wait 60 seconds between codes. If your signup expired, start again.');
    await deliver(record, challenge, code);
    return response(res, challenge);
  });
  app.post('/api/auth/signup/verify', verifyLimit, ready, async (req, res) => {
    const { challenge, code } = verification.parse(req.body);
    // Increment before comparison; the database enforces the attempt limit across concurrent requests.
    const record = await SignupChallenge.findOneAndUpdate({ challengeHash: hash(challenge), expiresAt: { $gt: new Date() }, attempts: { $lt: 5 } }, { $inc: { attempts: 1 } }, { new: true }).select('+otpHash');
    if (!record || !timingSafeEqual(Buffer.from(record.otpHash, 'hex'), Buffer.from(digest(challenge, code), 'hex'))) throw error(400, 'Code is invalid, expired, or has reached its attempt limit.');
    const consumed = await SignupChallenge.findOneAndDelete({ _id: record._id, challengeHash: hash(challenge), expiresAt: { $gt: new Date() } }).select('+passwordHash');
    if (!consumed) throw error(409, 'This code has already been used or replaced. Please sign in or start again.');
    // Role and manager are assigned only by the server/admin, never from signup input.
    const user = await User.create({ name: consumed.name, email: consumed.email, department: consumed.department, passwordHash: consumed.passwordHash, role: 'employee', active: true, emailVerifiedAt: new Date() });
    await signIn(user, req, res);
  });
}
