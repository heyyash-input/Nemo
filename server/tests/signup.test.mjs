import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createHash } from 'node:crypto';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createApp } from '../app.mjs';
import { User, Session, SignupChallenge, Policy } from '../models.mjs';
import { defaultPolicy } from '../domain.mjs';
import { readConfig } from '../config.mjs';
import { createMailer } from '../mail.mjs';

let mongo, app;
const messages = [];
const secret = 'test-only-otp-secret-at-least-32-characters';
const header = ['X-App-Request', 'ledgerly'];
const password = 'A-long-signup-password!';
const mailer = { ready: true, sendOtp: async (email, code) => { messages.push({ email, code }); } };
const hash = value => createHash('sha256').update(value).digest('hex');
const details = email => ({ name: 'New Employee', email, department: 'Engineering', password });
const codeFor = email => messages.filter(m => m.email === email).at(-1).code;
async function signup(email, target = app) { return (await request(target).post('/api/auth/signup').set(...header).send(details(email)).expect(202)).body; }
before(async () => {
  process.env.MONGOMS_DOWNLOAD_DIR = path.resolve('.data/mongodb-binaries');
  mongo = await MongoMemoryServer.create({ binary: { version: '7.0.14' } });
  await mongoose.connect(mongo.getUri('nemo_signup_test'));
  await Promise.all([User, Session, SignupChallenge, Policy].map(m => m.init()));
  await Policy.create(defaultPolicy);
  app = createApp({ mailer, otpSecret: secret });
});
after(async () => { await mongoose.disconnect(); if (mongo) await mongo.stop(); });

test('signup stores no user before OTP; verification creates only an employee with hashed credentials', async () => {
  const email = 'new@company.example'; const started = await signup(email);
  assert.equal(await User.countDocuments({ email }), 0);
  assert.equal(started.code, undefined);
  const pending = await SignupChallenge.findOne({ email }).select('+passwordHash +otpHash');
  assert.notEqual(pending.passwordHash, password);
  assert.notEqual(pending.otpHash, codeFor(email));
  assert.notEqual(pending.challengeHash, started.challenge);
  const agent = request.agent(app);
  const verified = await agent.post('/api/auth/signup/verify').set(...header).send({ challenge: started.challenge, code: codeFor(email) }).expect(200);
  assert.equal(verified.body.role, 'employee');
  assert.equal(verified.body.passwordHash, undefined);
  assert.equal(verified.body.managerId, undefined);
  const user = await User.findOne({ email }).select('+passwordHash');
  assert.ok(await bcrypt.compare(password, user.passwordHash));
  assert.ok(user.emailVerifiedAt);
  assert.equal(await SignupChallenge.countDocuments({ email }), 0);
  await agent.get('/api/auth/me').expect(200);
  await agent.get('/api/users').expect(403);
  await agent.get('/api/claims').expect(200).then(r => assert.deepEqual(r.body, []));
  await request(app).post('/api/auth/signup/verify').set(...header).send({ challenge: started.challenge, code: codeFor(email) }).expect(400);
  await agent.post('/api/auth/logout').set(...header).send({}).expect(200);
  await agent.get('/api/auth/me').expect(401);
  await agent.post('/api/auth/logout').set(...header).send({}).expect(200);
  await agent.post('/api/auth/login').set(...header).send({ email, password }).expect(200);
});
test('role injection and unconfigured SMTP fail before creating accounts', async () => {
  const target = createApp({ mailer, otpSecret: secret });
  await request(target).post('/api/auth/signup').set(...header).send({ ...details('attacker@company.example'), role: 'admin', active: true }).expect(400);
  assert.equal(await User.countDocuments({ email: 'attacker@company.example' }), 0);
  const unconfigured = createApp();
  await request(unconfigured).get('/api/config').expect(200).then(r => assert.equal(r.body.signupAvailable, false));
  await request(unconfigured).post('/api/auth/signup').set(...header).send(details('nomail@company.example')).expect(503);
  assert.equal(await SignupChallenge.countDocuments({ email: 'nomail@company.example' }), 0);
  await request(target).post('/api/auth/signup').set(...header).send({ ...details('unicode@company.example'), password: '😀'.repeat(20) }).expect(400);
});
test('invalid codes have a database-enforced five attempt limit even with concurrent requests', async () => {
  const target = createApp({ mailer, otpSecret: secret });
  const email = 'attempts@company.example'; const started = await signup(email, target);
  const correct = codeFor(email); const wrong = correct === '000000' ? '111111' : '000000';
  const responses = await Promise.all(Array.from({ length: 8 }, () => request(target).post('/api/auth/signup/verify').set(...header).send({ challenge: started.challenge, code: wrong })));
  assert.ok(responses.every(r => r.status === 400));
  assert.equal((await SignupChallenge.findOne({ email })).attempts, 5);
  await request(target).post('/api/auth/signup/verify').set(...header).send({ challenge: started.challenge, code: correct }).expect(400);
  assert.equal(await User.countDocuments({ email }), 0);
});
test('expired codes are rejected before TTL cleanup and codes are bound to their signup challenge', async () => {
  const a = await signup('expired@company.example');
  await SignupChallenge.updateOne({ email: 'expired@company.example' }, { $set: { expiresAt: new Date(Date.now() - 1) } });
  await request(app).post('/api/auth/signup/verify').set(...header).send({ challenge: a.challenge, code: codeFor('expired@company.example') }).expect(400);
  await request(app).post('/api/auth/signup/verify').set(...header).send({ challenge: 'a'.repeat(64), code: codeFor('expired@company.example') }).expect(400);
});
test('resend cooldown is atomic and replaces the previous challenge', async () => {
  const target = createApp({ mailer, otpSecret: secret }); const email = 'resend@company.example'; const original = await signup(email, target); const oldCode = codeFor(email);
  await request(target).post('/api/auth/signup/resend').set(...header).send({ challenge: original.challenge }).expect(429);
  await SignupChallenge.updateOne({ email }, { $set: { sentAt: new Date(Date.now() - 61000) } });
  const outcomes = await Promise.all([1, 2].map(() => request(target).post('/api/auth/signup/resend').set(...header).send({ challenge: original.challenge })));
  assert.deepEqual(outcomes.map(r => r.status).sort(), [202, 429]);
  const next = outcomes.find(r => r.status === 202).body;
  assert.notEqual(next.challenge, original.challenge);
  await request(target).post('/api/auth/signup/verify').set(...header).send({ challenge: original.challenge, code: oldCode }).expect(400);
  await request(target).post('/api/auth/signup/verify').set(...header).send({ challenge: next.challenge, code: codeFor(email) }).expect(200);
});
test('SMTP delivery failure invalidates the pending code and allows retry', async () => {
  let attempts = 0;
  const target = createApp({ otpSecret: secret, mailer: { ready: true, sendOtp: async () => { attempts++; throw new Error('private SMTP response'); } } });
  const email = 'mailfailure@company.example';
  const result = await request(target).post('/api/auth/signup').set(...header).send(details(email)).expect(503);
  assert.ok(!JSON.stringify(result.body).includes('private SMTP'));
  assert.equal(await SignupChallenge.countDocuments({ email }), 0);
  assert.equal(await User.countDocuments({ email }), 0);
  await request(target).post('/api/auth/signup').set(...header).send(details(email)).expect(503);
  assert.equal(attempts, 2);
});
test('existing accounts are not overwritten and duplicate verification creates at most one user', async () => {
  const target = createApp({ mailer, otpSecret: secret });
  const count = messages.length;
  await signup('new@company.example', target);
  assert.equal(messages.length, count);
  const user = await User.findOne({ email: 'new@company.example' }).select('+passwordHash');
  assert.ok(await bcrypt.compare(password, user.passwordHash));
  const email = 'concurrent@company.example'; const started = await signup(email, target);
  const responses = await Promise.all([1, 2].map(() => request(target).post('/api/auth/signup/verify').set(...header).send({ challenge: started.challenge, code: codeFor(email) })));
  assert.equal(responses.filter(r => r.status === 200).length, 1);
  assert.equal(await User.countDocuments({ email }), 1);
});
test('domain restriction, request origin, and production cookie settings are enforced', async () => {
  const target = createApp({ mailer, otpSecret: secret, allowedDomains: ['company.example'], production: true, origin: 'https://nemo.example.com', demo: true });
  await request(target).get('/api/config').expect(200).then(r => assert.equal(r.body.demo, false));
  await request(target).post('/api/auth/signup').set(...header).send(details('wrong@other.example')).expect(400);
  await request(target).post('/api/auth/signup').set(...header).set('Origin', 'https://evil.example').send(details('origin@company.example')).expect(403);
  await request(target).post('/api/auth/signup').send(details('header@company.example')).expect(403);
  const email = 'secure@company.example'; const started = await signup(email, target);
  const result = await request(target).post('/api/auth/signup/verify').set(...header).send({ challenge: started.challenge, code: codeFor(email) }).expect(200);
  const cookie = result.headers['set-cookie'][0];
  assert.match(cookie, /HttpOnly/); assert.match(cookie, /Secure/); assert.match(cookie, /SameSite=Strict/);
  await request(target).post('/api/auth/demo').set(...header).send({ role: 'admin' }).expect(401);
});
test('production startup validation fails on insecure origins and demo configuration', () => {
  assert.throws(() => readConfig({ NODE_ENV: 'production', APP_ORIGIN: 'http://nemo.example.com', MONGODB_URI: 'mongodb://example/nemo' }), /HTTPS/);
  assert.throws(() => readConfig({ NODE_ENV: 'production', APP_ORIGIN: 'https://nemo.example.com', MONGODB_URI: 'mongodb://example/nemo', SEED_DEMO: 'true' }), /Disable/);
  assert.equal(createMailer({}).ready, false);
  assert.equal(readConfig({ NODE_ENV: 'production', APP_ORIGIN: 'https://nemo.example.com', MONGODB_URI: 'mongodb://example/nemo' }).host, '0.0.0.0');
});
