import { before, beforeEach, after, test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createApp } from '../app.mjs';
import { connectDatabase } from '../database.mjs';
import { initializePolicy } from '../seed.mjs';
import { readConfig } from '../config.mjs';
import { today, journalEntries } from '../domain.mjs';
import { User, Session, Policy, Claim, Receipt, AdminAudit } from '../models.mjs';

let mongo, database, app, users, agents;
const password = 'Service-test-password';
const header = ['X-App-Request', 'ledgerly'];
const models = [User, Session, Policy, Claim, Receipt, AdminAudit];
before(
  /* Connect the real database service to a disposable test database. */ async () => {
    process.env.MONGOMS_DOWNLOAD_DIR = path.resolve('.data/mongodb-binaries');
    mongo = await MongoMemoryServer.create({ binary: { version: '7.0.14' } });
    process.env.MONGODB_URI = mongo.getUri('nemo_services_test');
    process.env.NODE_ENV = 'test';
    database = await connectDatabase();
    await Promise.all(
      models.map(/* Initialize unique indexes before testing. */ (model) => model.init()),
    );
  },
);
beforeEach(
  /* Give every service case independent users, policy, and sessions. */ async () => {
    await Promise.all(
      models.map(/* Clear only the isolated test collections. */ (model) => model.deleteMany({})),
    );
    await initializePolicy();
    app = createApp();
    users = {};
    agents = {};
    const passwordHash = await bcrypt.hash(password, 4);
    for (const role of ['manager', 'employee', 'finance', 'admin', 'outsider']) {
      users[role] = await User.create({
        name: role,
        email: `${role}@services.example`,
        role: role === 'outsider' ? 'employee' : role,
        department: 'Engineering',
        passwordHash,
        ...(role !== 'manager' ? { managerId: users.manager._id } : {}),
      });
      agents[role] = request.agent(app);
      await agents[role]
        .post('/api/auth/login')
        .set(...header)
        .send({ email: users[role].email, password })
        .expect(200);
    }
  },
);
after(
  /* Release the database connection and stop the temporary MongoDB. */ async () => {
    if (database) await database.close();
    if (mongo) await mongo.stop();
  },
);
/** Build administrator input from a stored user without exposing its password hash. */
function userInput(user, changes = {}) {
  return {
    name: user.name,
    email: user.email,
    role: user.role,
    department: user.department,
    managerId: user.managerId ? String(user.managerId) : null,
    active: true,
    ...changes,
  };
}
/** Create a valid receipt-backed draft for one test employee. */
async function draft(agent = agents.employee) {
  const receipt = await agent
    .post('/api/receipts')
    .set(...header)
    .attach('receipt', Buffer.from('%PDF-1.4\nTest receipt'), 'receipt.pdf')
    .expect(201);
  const input = {
    title: 'Service test expense',
    purpose: 'Testing the complete expense service',
    items: [
      {
        category: 'Travel',
        date: today(),
        merchant: 'Railways',
        amountMinor: 12000,
        receiptId: receipt.body._id,
      },
    ],
  };
  const result = await agent
    .post('/api/claims')
    .set(...header)
    .send(input)
    .expect(201);
  return { claim: result.body, input, receiptId: receipt.body._id };
}

test('health service detects database disconnection and recovery', /* Confirm health follows actual database readiness. */ async () => {
  assert.equal(database.local, false);
  await request(app).get('/api/health').expect(200, { status: 'ok' });
  await mongoose.disconnect();
  try {
    await request(app).get('/api/health').expect(503, { status: 'unavailable' });
  } finally {
    await mongoose.connect(process.env.MONGODB_URI);
  }
  await request(app).get('/api/health').expect(200);
});

test('session service rejects bad credentials, expired sessions, and disabled accounts', /* Exercise authentication failures and safe repeated logout. */ async () => {
  await request(app)
    .post('/api/auth/login')
    .set(...header)
    .send({ email: users.employee.email, password: 'incorrect' })
    .expect(401);
  await Session.updateMany({ userId: users.employee._id }, { $set: { expiresAt: new Date(0) } });
  await agents.employee.get('/api/auth/me').expect(401);
  await User.updateOne({ _id: users.outsider._id }, { $set: { active: false } });
  await agents.outsider.get('/api/auth/me').expect(401);
  await request(app)
    .post('/api/auth/login')
    .set(...header)
    .send({ email: users.outsider.email, password })
    .expect(401);
  for (let i = 0; i < 2; i++)
    await agents.employee
      .post('/api/auth/logout')
      .set(...header)
      .expect(200);
});

test('password service validates the old password and revokes every session', /* Check password changes persist securely and invalidate previous logins. */ async () => {
  const other = request.agent(app);
  await other
    .post('/api/auth/login')
    .set(...header)
    .send({ email: users.employee.email, password })
    .expect(200);
  await agents.employee
    .post('/api/auth/password')
    .set(...header)
    .send({ currentPassword: 'wrong', newPassword: 'New-service-password' })
    .expect(400);
  await agents.employee
    .post('/api/auth/password')
    .set(...header)
    .send({ currentPassword: password, newPassword: 'short' })
    .expect(400);
  await agents.employee
    .post('/api/auth/password')
    .set(...header)
    .send({ currentPassword: password, newPassword: 'New-service-password' })
    .expect(200);
  await other.get('/api/auth/me').expect(401);
  await agents.employee.get('/api/auth/me').expect(401);
  await request(app)
    .post('/api/auth/login')
    .set(...header)
    .send({ email: users.employee.email, password })
    .expect(401);
  await request(app)
    .post('/api/auth/login')
    .set(...header)
    .send({ email: users.employee.email, password: 'New-service-password' })
    .expect(200);
  const stored = await User.findById(users.employee._id).select('+passwordHash');
  assert.notEqual(stored.passwordHash, 'New-service-password');
  assert.equal(await bcrypt.compare('New-service-password', stored.passwordHash), true);
});

test('login rate limit and production cookies protect authentication', /* Check throttling and browser session cookie attributes. */ async () => {
  const limited = createApp();
  for (let i = 0; i < 30; i++)
    await request(limited)
      .post('/api/auth/login')
      .set(...header)
      .send({ email: 'missing@services.example', password })
      .expect(401);
  await request(limited)
    .post('/api/auth/login')
    .set(...header)
    .send({ email: 'missing@services.example', password })
    .expect(429);
  const production = createApp({
    jwtSecret: 'test-only-signing-secret-at-least-32-bytes',
    production: true,
    origin: 'https://nemo.example.com',
  });
  const login = await request(production)
    .post('/api/auth/login')
    .set(...header)
    .set('Origin', 'https://nemo.example.com')
    .send({ email: users.employee.email, password })
    .expect(200);
  const cookie = login.headers['set-cookie'][0];
  for (const attribute of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/api'])
    assert.ok(cookie.includes(attribute));
});

test('user service creates accounts, validates managers, and rejects duplicates', /* Cover account creation through the administrator API. */ async () => {
  const input = userInput(users.employee, {
    name: 'New Person',
    email: 'new@services.example',
    password,
  });
  await agents.employee
    .post('/api/users')
    .set(...header)
    .send(input)
    .expect(403);
  await agents.admin
    .post('/api/users')
    .set(...header)
    .send({ ...input, managerId: null })
    .expect(400);
  await agents.admin
    .post('/api/users')
    .set(...header)
    .send({ ...input, managerId: String(users.finance._id) })
    .expect(400);
  const created = await agents.admin
    .post('/api/users')
    .set(...header)
    .send(input)
    .expect(201);
  assert.equal(created.body.passwordHash, undefined);
  await agents.admin
    .post('/api/users')
    .set(...header)
    .send(input)
    .expect(409);
  await request(app)
    .post('/api/auth/login')
    .set(...header)
    .send({ email: input.email, password })
    .expect(200);
});

test('user updates revoke sessions and protect administrators and manager assignments', /* Check access changes and self-lockout protections. */ async () => {
  await agents.admin
    .put(`/api/users/${users.admin._id}`)
    .set(...header)
    .send(userInput(users.admin, { active: false }))
    .expect(400);
  await agents.admin
    .put(`/api/users/${users.admin._id}`)
    .set(...header)
    .send(userInput(users.admin, { role: 'employee' }))
    .expect(400);
  await agents.admin
    .put(`/api/users/${users.employee._id}`)
    .set(...header)
    .send(userInput(users.employee, { managerId: String(users.employee._id) }))
    .expect(400);
  await agents.admin
    .put(`/api/users/${users.manager._id}`)
    .set(...header)
    .send(userInput(users.manager, { active: false }))
    .expect(409);
  await agents.admin
    .put(`/api/users/${users.outsider._id}`)
    .set(...header)
    .send(userInput(users.outsider, { role: 'finance' }))
    .expect(200);
  await agents.outsider.get('/api/auth/me').expect(401);
  const changed = await request(app)
    .post('/api/auth/login')
    .set(...header)
    .send({ email: users.outsider.email, password })
    .expect(200);
  assert.equal(changed.body.role, 'finance');
  await agents.admin
    .put(`/api/users/${users.employee._id}`)
    .set(...header)
    .send(userInput(users.employee, { active: false }))
    .expect(200);
  await agents.employee.get('/api/auth/me').expect(401);
});

test('policy service rejects invalid rules and stale updates', /* Check policy reads, unique categories, numeric limits, and optimistic versions. */ async () => {
  const original = (await agents.employee.get('/api/policy').expect(200)).body;
  await agents.admin
    .put('/api/policy')
    .set(...header)
    .send({ ...original, version: original.__v, maxClaimMinor: -1 })
    .expect(400);
  await agents.admin
    .put('/api/policy')
    .set(...header)
    .send({
      ...original,
      version: original.__v,
      categories: [original.categories[0], original.categories[0]],
    })
    .expect(400);
  const input = { ...original, version: original.__v, submissionWindowDays: 30 };
  await agents.admin
    .put('/api/policy')
    .set(...header)
    .send(input)
    .expect(200);
  await agents.admin
    .put('/api/policy')
    .set(...header)
    .send(input)
    .expect(409);
  await initializePolicy();
  assert.equal((await Policy.findOne()).submissionWindowDays, 30);
});

test('receipt service supports allowed signatures and rejects missing, oversized, and multiple files', /* Test upload validation and protected attachment downloads. */ async () => {
  const samples = [
    ['pdf', Buffer.from('%PDF-1.4\nTest'), 'application/pdf'],
    ['png', Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), 'image/png'],
    ['jpg', Buffer.from([255, 216, 255, 0]), 'image/jpeg'],
  ];
  for (const [ext, data, mime] of samples) {
    const uploaded = await agents.employee
      .post('/api/receipts')
      .set(...header)
      .attach('receipt', data, `receipt.${ext}`)
      .expect(201);
    const download = await agents.employee.get(`/api/receipts/${uploaded.body._id}`).expect(200);
    assert.ok(download.headers['content-type'].startsWith(mime));
    assert.match(download.headers['content-disposition'], /^attachment;/);
    await agents.outsider.get(`/api/receipts/${uploaded.body._id}`).expect(404);
  }
  await agents.employee
    .post('/api/receipts')
    .set(...header)
    .expect(400);
  await agents.employee
    .post('/api/receipts')
    .set(...header)
    .attach('receipt', Buffer.alloc(5 * 1024 * 1024 + 1), 'big.pdf')
    .expect(400);
  await agents.employee
    .post('/api/receipts')
    .set(...header)
    .attach('receipt', samples[0][1], 'one.pdf')
    .attach('receipt', samples[0][1], 'two.pdf')
    .expect(400);
  await agents.employee.get('/api/receipts/invalid-id').expect(400);
});

test('claim service rejects reused lines and foreign receipts and scopes claim lists', /* Check draft ownership, receipt validation, and visibility after submission. */ async () => {
  const own = await draft();
  const foreign = await draft(agents.outsider);
  await agents.employee
    .post('/api/claims')
    .set(...header)
    .send({ ...own.input, items: [own.input.items[0], own.input.items[0]] })
    .expect(400);
  await agents.employee
    .post('/api/claims')
    .set(...header)
    .send({ ...own.input, items: [{ ...own.input.items[0], receiptId: foreign.receiptId }] })
    .expect(400);
  assert.equal((await agents.manager.get('/api/claims').expect(200)).body.length, 0);
  assert.equal((await agents.admin.get('/api/claims').expect(200)).body.length, 0);
  await agents.employee
    .post(`/api/claims/${own.claim._id}/submit`)
    .set(...header)
    .send({})
    .expect(200);
  for (const role of ['manager', 'finance', 'admin'])
    assert.equal((await agents[role].get('/api/claims').expect(200)).body.length, 1);
  const unrelated = (await agents.outsider.get('/api/claims').expect(200)).body;
  assert.equal(unrelated.length, 1);
  assert.equal(unrelated[0]._id, foreign.claim._id);
});

test('finance rejection preserves a reason and allows correction', /* Check the second approval stage can reject a manager-approved claim. */ async () => {
  const { claim, input } = await draft();
  const base = `/api/claims/${claim._id}`;
  await agents.employee
    .post(`${base}/submit`)
    .set(...header)
    .send({})
    .expect(200);
  await agents.manager
    .post(`${base}/decision`)
    .set(...header)
    .send({ decision: 'approve' })
    .expect(200);
  const rejected = await agents.finance
    .post(`${base}/decision`)
    .set(...header)
    .send({ decision: 'reject', note: 'Please correct the merchant details.' })
    .expect(200);
  assert.equal(rejected.body.status, 'rejected');
  assert.equal(rejected.body.history.at(-1).note, 'Please correct the merchant details.');
  const revised = await agents.employee
    .put(base)
    .set(...header)
    .send({ ...input, version: rejected.body.__v })
    .expect(200);
  assert.equal(revised.body.status, 'draft');
});

test('reimbursement service validates dates and records UPI with balanced journal entries', /* Cover settlement validation and the UPI payment method. */ async () => {
  const { claim } = await draft();
  const base = `/api/claims/${claim._id}`;
  await agents.employee
    .post(`${base}/submit`)
    .set(...header)
    .send({})
    .expect(200);
  await agents.manager
    .post(`${base}/decision`)
    .set(...header)
    .send({ decision: 'approve' })
    .expect(200);
  await agents.finance
    .post(`${base}/decision`)
    .set(...header)
    .send({ decision: 'approve' })
    .expect(200);
  for (const date of ['2099-01-01', '2000-01-01'])
    await agents.finance
      .post(`${base}/settle`)
      .set(...header)
      .send({ date, method: 'UPI', reference: 'UPI-TEST' })
      .expect(400);
  const paid = await agents.finance
    .post(`${base}/settle`)
    .set(...header)
    .send({ date: today(), method: 'UPI', reference: 'UPI-TEST' })
    .expect(200);
  assert.equal(paid.body.settlement.method, 'UPI');
  assert.match(paid.body.settlement.entries.at(-1).account, /Bank$/);
  const entries = journalEntries(
    {
      totalMinor: 300,
      policySnapshot: { categories: [{ name: 'Travel', account: 'Travel expense' }] },
      items: [
        { category: 'Travel', amountMinor: 100 },
        { category: 'Travel', amountMinor: 200 },
      ],
    },
    'Cash',
  );
  assert.equal(entries.length, 2);
  assert.equal(entries[0].debitMinor, 300);
  assert.equal(entries[1].creditMinor, 300);
});

test('audit service includes user, policy, and claim events in date order', /* Check audit visibility and data from each event source. */ async () => {
  await draft();
  await agents.admin
    .post('/api/users')
    .set(...header)
    .send(userInput(users.employee, { email: 'audit@services.example', password }))
    .expect(201);
  const policy = (await agents.admin.get('/api/policy')).body;
  await agents.admin
    .put('/api/policy')
    .set(...header)
    .send({ ...policy, version: policy.__v })
    .expect(200);
  const rows = (await agents.admin.get('/api/audit').expect(200)).body;
  for (const action of ['Created draft', 'Created user', 'Updated expense policy'])
    assert.ok(rows.some(/* Find the expected audit action. */ (row) => row.action === action));
  for (let i = 1; i < rows.length; i++)
    assert.ok(Date.parse(rows[i - 1].createdAt) >= Date.parse(rows[i].createdAt));
  await agents.finance.get('/api/audit').expect(403);
});

test('admin bootstrap creates the first admin and refuses a second', /* Run the actual bootstrap command against the disposable database. */ async () => {
  await User.deleteOne({ _id: users.admin._id });
  const env = {
    ...process.env,
    ADMIN_EMAIL: 'bootstrap@services.example',
    ADMIN_PASSWORD: password,
  };
  const first = spawnSync(process.execPath, ['server/create-admin.mjs'], {
    env,
    encoding: 'utf8',
    timeout: 20000,
  });
  assert.equal(first.status, 0, first.stderr);
  assert.equal((await User.findOne({ email: env.ADMIN_EMAIL })).role, 'admin');
  const second = spawnSync(process.execPath, ['server/create-admin.mjs'], {
    env,
    encoding: 'utf8',
    timeout: 20000,
  });
  assert.notEqual(second.status, 0);
  assert.match(second.stderr, /administrator already exists/);
});

test('configuration and error services reject invalid requests', /* Check deployment settings, route errors, and invalid JSON handling. */ async () => {
  for (const env of [
    { APP_ORIGIN: 'invalid' },
    { APP_ORIGIN: 'http://localhost:5173/path' },
    { PORT: '0' },
    { PORT: '65536' },
    { NODE_ENV: 'production', APP_ORIGIN: 'https://nemo.example.com' },
  ])
    assert.throws(/* Reject the invalid configuration. */ () => readConfig(env));
  assert.deepEqual(readConfig({ TRUST_PROXY: '127.0.0.1, ::1' }).trustProxy, ['127.0.0.1', '::1']);
  await agents.employee.get('/api/unknown-route').expect(404);
  await agents.employee.get('/api/claims/not-an-id').expect(400);
  const invalid = await agents.employee
    .post('/api/claims')
    .set(...header)
    .set('Content-Type', 'application/json')
    .send('{bad json')
    .expect(400);
  assert.equal(invalid.body.stack, undefined);
});
