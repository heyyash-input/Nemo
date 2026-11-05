import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { createHash } from 'node:crypto';
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import mongoose from 'mongoose';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createApp } from '../app.mjs';
import { User, Session } from '../models.mjs';
import { ensureDemoAccounts } from '../seed.mjs';
import { readConfig } from '../config.mjs';
import { passwordInput } from '../domain.mjs';

let mongo, app;
const header = ['X-App-Request', 'ledgerly'];
const password = 'Nemo-demo-test-password';
before(
  /* Create demo accounts in an isolated database without email configuration. */ async () => {
    process.env.MONGOMS_DOWNLOAD_DIR = path.resolve('.data/mongodb-binaries');
    process.env.NODE_ENV = 'test';
    process.env.DEMO_MODE = 'true';
    process.env.DEMO_PASSWORD = password;
    mongo = await MongoMemoryServer.create({ binary: { version: '7.0.14' } });
    await mongoose.connect(mongo.getUri('nemo_auth_test'));
    await Promise.all(
      [User, Session].map(
        /* Create indexes before testing account creation. */ (model) => model.init(),
      ),
    );
    await ensureDemoAccounts();
    app = createApp({ demo: true });
  },
);
after(
  /* Close the isolated database after authentication checks. */ async () => {
    await mongoose.disconnect();
    if (mongo) await mongo.stop();
  },
);

test('all demo roles support password login, shortcuts, and logout', /* Verify the complete local demo login flow. */ async () => {
  for (const role of ['employee', 'manager', 'finance', 'admin']) {
    const agent = request.agent(app);
    const result = await agent
      .post('/api/auth/login')
      .set(...header)
      .send({ email: `${role}@nemo.demo`, password })
      .expect(200);
    assert.equal(result.body.role, role);
    assert.equal(result.body.passwordHash, undefined);
    await agent.get('/api/auth/me').expect(200);
    await agent
      .post('/api/auth/logout')
      .set(...header)
      .expect(200);
    await agent.get('/api/auth/me').expect(401);
    const shortcut = await agent
      .post('/api/auth/demo')
      .set(...header)
      .send({ role })
      .expect(200);
    assert.equal(shortcut.body.role, role);
    await agent
      .post('/api/auth/logout')
      .set(...header)
      .expect(200);
  }
  const employee = await User.findOne({ email: 'employee@nemo.demo' });
  const manager = await User.findOne({ email: 'manager@nemo.demo' });
  assert.equal(String(employee.managerId), String(manager._id));
});

test('removed OTP routes cannot create accounts', /* Verify that no old registration endpoint remains accessible. */ async () => {
  const count = await User.countDocuments();
  const agent = request.agent(app);
  await agent
    .post('/api/auth/demo')
    .set(...header)
    .send({ role: 'admin' })
    .expect(200);
  for (const endpoint of ['/auth/signup/resend', '/auth/signup/verify']) {
    await request(app)
      .post(`/api${endpoint}`)
      .set(...header)
      .send({})
      .expect(401);
    await agent
      .post(`/api${endpoint}`)
      .set(...header)
      .send({})
      .expect(404);
  }
  assert.equal(await User.countDocuments(), count);
  const config = await agent.get('/api/config').expect(200);
  assert.deepEqual(config.body, { demo: true, currency: 'INR' });
});

test('demo setup preserves accounts and production blocks demo access', /* Check repeat startup and production role restrictions. */ async () => {
  const existing = await User.findOne({ email: 'employee@nemo.demo' }).select('+passwordHash');
  await ensureDemoAccounts();
  const current = await User.findById(existing._id).select('+passwordHash');
  assert.equal(current.passwordHash, existing.passwordHash);
  assert.equal(await User.countDocuments(), 4);
  const production = createApp({
    demo: true,
    jwtSecret: 'test-only-signing-secret-at-least-32-bytes',
    production: true,
  });
  await request(production)
    .post('/api/auth/demo')
    .set(...header)
    .send({ role: 'admin' })
    .expect(401);
  await request(production)
    .post('/api/auth/login')
    .set(...header)
    .send({ email: 'admin@nemo.demo', password })
    .expect(401);
  const config = await request(production).get('/api/config').expect(200);
  assert.equal(config.body.demo, false);
});

test('password and production configuration validation remain enforced', /* Check shared password limits and production requirements without mail settings. */ () => {
  assert.equal(passwordInput.safeParse('short').success, false);
  assert.equal(passwordInput.safeParse('😀'.repeat(20)).success, false);
  assert.equal(passwordInput.parse(password), password);
  const valid = {
    JWT_SECRET: 'test-only-signing-secret-at-least-32-bytes',
    NODE_ENV: 'production',
    APP_ORIGIN: 'https://nemo.example.com',
    MONGODB_URI: 'mongodb://example/nemo',
  };
  assert.equal(readConfig(valid).production, true);
  assert.throws(
    /* Reject HTTP in production. */ () =>
      readConfig({ ...valid, APP_ORIGIN: 'http://nemo.example.com' }),
    /HTTPS/,
  );
  assert.throws(
    /* Reject production demo shortcuts. */ () => readConfig({ ...valid, DEMO_MODE: 'true' }),
    /Disable/,
  );
});

test('signup creates an employee with a hashed password and a JWT session', /* Exercise signup, duplicate protection, login, and access control. */ async () => {
  const agent = request.agent(app);
  const input = {
    name: 'Asha Rao',
    email: 'ASHA@example.com',
    department: 'Engineering',
    password: 'Sample-signup-password',
  };
  const result = await agent
    .post('/api/auth/signup')
    .set(...header)
    .send(input)
    .expect(201);
  assert.equal(result.body.role, 'employee');
  assert.equal(result.body.email, 'asha@example.com');
  assert.equal(result.body.passwordHash, undefined);
  const user = await User.findById(result.body._id).select('+passwordHash');
  assert.equal(await bcrypt.compare(input.password, user.passwordHash), true);
  assert.equal(user.managerId, undefined);
  await agent.get('/api/auth/me').expect(200);
  await agent.get('/api/users').expect(403);
  const cookie = result.headers['set-cookie'][0].split(';')[0];
  assert.ok(result.headers['set-cookie'][0].includes('HttpOnly'));
  const payload = jwt.decode(cookie.slice('session='.length));
  assert.equal(payload.sub, String(user._id));
  assert.equal(payload.exp - payload.iat, 900);
  assert.equal(payload.password, undefined);
  assert.equal(payload.role, undefined);
  await agent
    .post('/api/auth/logout')
    .set(...header)
    .expect(200);
  await request(app).get('/api/auth/me').set('Cookie', cookie).expect(401);
  await request(app)
    .post('/api/auth/login')
    .set(...header)
    .send({ email: input.email, password: input.password })
    .expect(200);
  await request(app)
    .post('/api/auth/signup')
    .set(...header)
    .send(input)
    .expect(409);
});

test('signup rejects privilege fields, invalid input, cross-origin requests, and bursts', /* Keep public registration restricted to valid employees. */ async () => {
  const input = {
    name: 'Ravi Shah',
    email: 'ravi@example.com',
    department: 'Sales',
    password: 'Sample-signup-password',
  };
  for (const changes of [
    { role: 'admin' },
    { active: true },
    { managerId: '123' },
    { password: 'short' },
    { department: '' },
    { email: 'bad' },
    { email: 'admin@nemo.demo' },
  ]) {
    await request(app)
      .post('/api/auth/signup')
      .set(...header)
      .send({ ...input, ...changes })
      .expect(400);
  }
  await request(app).post('/api/auth/signup').send(input).expect(403);
  await request(app)
    .post('/api/auth/signup')
    .set(...header)
    .set('Origin', 'https://other.example')
    .send(input)
    .expect(403);
  const limited = createApp();
  for (let i = 0; i < 30; i++)
    await request(limited)
      .post('/api/auth/signup')
      .set(...header)
      .send({})
      .expect(400);
  await request(limited)
    .post('/api/auth/signup')
    .set(...header)
    .send(input)
    .expect(429);
  assert.equal(await User.exists({ email: input.email }), null);
});

test('JWT validation rejects forged, expired, wrong-audience, and unsigned tokens even with a session record', /* Prove cryptographic validation independently of session lookup. */ async () => {
  const secret = 'test-only-signing-secret-at-least-32-bytes';
  const secured = createApp({ jwtSecret: secret });
  const user = await User.findOne({ email: 'employee@nemo.demo' });
  const options = {
    algorithm: 'HS256',
    subject: String(user._id),
    jwtid: 'test-token',
    issuer: 'nemo',
    audience: 'nemo-web',
    expiresIn: '15m',
  };
  const tokens = [
    jwt.sign({}, 'another-secret-at-least-32-bytes-long', options),
    jwt.sign({}, secret, { ...options, expiresIn: -1 }),
    jwt.sign({}, secret, { ...options, audience: 'other-app' }),
    jwt.sign({}, secret, { ...options, issuer: 'other-issuer' }),
    jwt.sign({}, secret, { ...options, algorithm: 'HS384' }),
    jwt.sign({}, null, { ...options, algorithm: 'none' }),
    'not-a-jwt',
  ];
  for (const token of tokens) {
    await Session.create({
      userId: user._id,
      tokenHash: createHash('sha256').update(token).digest('hex'),
      expiresAt: new Date(Date.now() + 60000),
    });
    await request(secured).get('/api/auth/me').set('Cookie', `session=${token}`).expect(401);
  }
  const login = await request(secured)
    .post('/api/auth/login')
    .set(...header)
    .send({ email: user.email, password })
    .expect(200);
  const cookie = login.headers['set-cookie'][0].split(';')[0];
  const claims = jwt.verify(cookie.slice('session='.length), secret, {
    algorithms: ['HS256'],
    issuer: 'nemo',
    audience: 'nemo-web',
  });
  assert.equal(claims.sub, String(user._id));
  await request(secured).get('/api/auth/me').set('Cookie', cookie).expect(200);
  const rotated = createApp({ jwtSecret: 'a-new-signing-secret-at-least-32-bytes' });
  await request(rotated).get('/api/auth/me').set('Cookie', cookie).expect(401);
});

test('production requires a strong configured JWT secret', /* Reject missing or too-short signing keys before serving requests. */ () => {
  const config = {
    NODE_ENV: 'production',
    APP_ORIGIN: 'https://nemo.example.com',
    MONGODB_URI: 'mongodb://example/nemo',
  };
  assert.throws(() => readConfig(config), /JWT_SECRET/);
  assert.throws(() => readConfig({ ...config, JWT_SECRET: 'short' }), /JWT_SECRET/);
  assert.throws(() => createApp({ jwtSecret: 'short' }), /JWT_SECRET/);
});
