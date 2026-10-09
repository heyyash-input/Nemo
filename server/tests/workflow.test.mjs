import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createApp } from '../app.mjs';
import { Claim, Policy, Receipt, Session, User, AdminAudit } from '../models.mjs';
import { defaultPolicy, today, validatePolicy } from '../domain.mjs';

let mongo, app, employee, manager, finance, admin, outsider;
let users = {};
const header = ['X-App-Request', 'ledgerly'];
const agents = {};
const password = 'Workflow-test-2026';
before(async () => {
  process.env.MONGOMS_DOWNLOAD_DIR = path.resolve('.data/mongodb-binaries');
  mongo = await MongoMemoryServer.create({ binary: { version: '7.0.14' } });
  await mongoose.connect(mongo.getUri('ledgerly_test'));
  await Promise.all([User, Claim, Policy, Receipt, Session, AdminAudit].map(m => m.init()));
  const passwordHash = await bcrypt.hash(password, 4);
  users.manager = await User.create({ name: 'Manager', email: 'manager@test.example', role: 'manager', department: 'Engineering', passwordHash });
  for (const role of ['employee', 'finance', 'admin', 'outsider']) {
    users[role] = await User.create({ name: role, email: `${role}@test.example`, role: role === 'outsider' ? 'employee' : role, department: 'Engineering', managerId: users.manager._id, passwordHash });
  }
  await Policy.create(defaultPolicy);
  app = createApp();
  for (const role of Object.keys(users)) {
    agents[role] = request.agent(app);
    await agents[role].post('/api/auth/login').set(...header).send({ email: `${role}@test.example`, password }).expect(200);
  }
  ({ employee, manager, finance, admin, outsider } = agents);
});
after(async () => { await mongoose.disconnect(); if (mongo) await mongo.stop(); });

async function draft(agent = employee, amountMinor = 12000) {
  const file = Buffer.from('%PDF-1.4\nDemo receipt for workflow tests\n%%EOF');
  const upload = await agent.post('/api/receipts').set(...header).attach('receipt', file, { filename: 'receipt.pdf', contentType: 'application/pdf' }).expect(201);
  const input = { title: 'Client workshop expenses', purpose: 'Materials for the client workshop.', items: [{ category: 'Office supplies', date: today(), merchant: 'Paper House', amountMinor, receiptId: upload.body._id }] };
  const result = await agent.post('/api/claims').set(...header).send(input).expect(201);
  return { claim: result.body, input, receiptId: upload.body._id };
}
async function verified() {
  const data = await draft();
  const base = `/api/claims/${data.claim._id}`;
  await employee.post(`${base}/submit`).set(...header).send({}).expect(200);
  await manager.post(`${base}/decision`).set(...header).send({ decision: 'approve' }).expect(200);
  await finance.post(`${base}/decision`).set(...header).send({ decision: 'approve' }).expect(200);
  return data;
}

test('authentication, CSRF header, request origin, and role restrictions are enforced', async () => {
  await request(app).get('/api/claims').expect(401);
  await request(app).post('/api/auth/login').send({ email: 'employee@test.example', password }).expect(403);
  await employee.post('/api/claims').set(...header).set('Origin', 'https://attacker.example').send({}).expect(403);
  await employee.get('/api/users').expect(403);
  await employee.get('/api/audit').expect(403);
  await employee.put('/api/policy').set(...header).send(defaultPolicy).expect(403);
  await request(app).post('/api/auth/demo').set(...header).send({ role: 'admin' }).expect(401);
  const profile = await employee.get('/api/auth/me').expect(200);
  assert.equal(profile.body.passwordHash, undefined);
  const allUsers = await admin.get('/api/users').expect(200);
  assert.ok(allUsers.body.every(u => !u.passwordHash));
});
test('drafts and receipts stay private until submission; unrelated employees cannot read claims', async () => {
  const { claim, receiptId } = await draft();
  await manager.get(`/api/claims/${claim._id}`).expect(404);
  await manager.get(`/api/receipts/${receiptId}`).expect(404);
  await outsider.get(`/api/claims/${claim._id}`).expect(404);
  await outsider.get(`/api/receipts/${receiptId}`).expect(404);
  await employee.get(`/api/receipts/${receiptId}`).expect(200).expect('Content-Type', /application\/pdf/);
  await employee.post(`/api/claims/${claim._id}/submit`).set(...header).send({}).expect(200);
  await manager.get(`/api/receipts/${receiptId}`).expect(200);
  await outsider.get(`/api/receipts/${receiptId}`).expect(404);
});
test('policy prevents missing receipts, excessive amounts, and invalid dates', async () => {
  const { claim } = await draft(employee, defaultPolicy.categories.find(c => c.name === 'Office supplies').limitMinor + 1);
  const result = await employee.post(`/api/claims/${claim._id}/submit`).set(...header).send({}).expect(422);
  assert.match(result.body.details[0], /exceeds/);
  assert.equal((await Claim.findById(claim._id)).status, 'draft');
  const invalid = await employee.post('/api/claims').set(...header).send({ title: 'Invalid date', purpose: 'Checking invalid calendar dates', items: [{ category: 'Travel', merchant: 'Railway', date: '2026-02-30', amountMinor: 100 }] }).expect(400);
  assert.ok(invalid.body.details.some(d => /calendar date/.test(d)));
  const problems = validatePolicy({ totalMinor: 100, items: [{ category: 'Travel', amountMinor: 100, date: '2099-01-01' }] }, defaultPolicy, '2026-10-09');
  assert.ok(problems.some(p => /receipt/.test(p)));
  assert.ok(problems.some(p => /future/.test(p)));
  await employee.post('/api/receipts').set(...header).attach('receipt', Buffer.from('<script>alert(1)</script>'), { filename: 'receipt.pdf', contentType: 'application/pdf' }).expect(400);
});
test('finance cannot skip manager review; rejection requires remarks and allows correction', async () => {
  const { claim, input } = await draft(); const base = `/api/claims/${claim._id}`;
  await employee.post(`${base}/submit`).set(...header).send({}).expect(200);
  await finance.post(`${base}/decision`).set(...header).send({ decision: 'approve' }).expect(409);
  await manager.post(`${base}/decision`).set(...header).send({ decision: 'reject', note: '' }).expect(400);
  const rejected = await manager.post(`${base}/decision`).set(...header).send({ decision: 'reject', note: 'Please explain the business purpose.' }).expect(200);
  assert.equal(rejected.body.status, 'rejected');
  const revised = await employee.put(base).set(...header).send({ ...input, purpose: 'Revised detailed purpose for the client workshop.', version: rejected.body.__v }).expect(200);
  assert.equal(revised.body.status, 'draft');
  await employee.post(`${base}/submit`).set(...header).send({}).expect(200);
  const current = await employee.get(base).expect(200);
  assert.ok(current.body.history.some(h => h.note === 'Please explain the business purpose.'));
});
test('stale draft edits cannot overwrite newer work', async () => {
  const { claim, input } = await draft();
  await employee.put(`/api/claims/${claim._id}`).set(...header).send({ ...input, title: 'First edit', version: claim.__v }).expect(200);
  await employee.put(`/api/claims/${claim._id}`).set(...header).send({ ...input, title: 'Stale edit', version: claim.__v }).expect(409);
  assert.equal((await Claim.findById(claim._id)).title, 'First edit');
});
test('simultaneous submissions cannot reuse an uploaded receipt', async () => {
  const { claim, input } = await draft();
  const second = await employee.post('/api/claims').set(...header).send({ ...input, title: 'Second claim using same receipt' }).expect(201);
  const attempts = await Promise.all([claim._id, second.body._id].map(claimId => employee.post(`/api/claims/${claimId}/submit`).set(...header).send({})));
  assert.equal(attempts.filter(r => r.status === 200).length, 1);
  assert.equal(attempts.filter(r => [409, 422].includes(r.status)).length, 1);
});
test('complete reimbursement is atomic, balanced, immutable, and cannot be recorded twice', async () => {
  const { claim } = await verified(); const base = `/api/claims/${claim._id}`;
  await employee.post(`${base}/settle`).set(...header).send({ date: today(), method: 'UPI', reference: 'TEST-01' }).expect(403);
  const attempts = await Promise.all([1, 2].map(() => finance.post(`${base}/settle`).set(...header).send({ date: today(), method: 'Bank transfer', reference: 'NEFT-TEST-001' })));
  assert.deepEqual(attempts.map(r => r.status).sort(), [200, 409]);
  const result = (await employee.get(base).expect(200)).body;
  assert.equal(result.status, 'reimbursed');
  assert.equal(result.history.filter(h => h.action === 'Reimbursement recorded').length, 1);
  assert.equal(result.settlement.entries.reduce((s, e) => s + e.debitMinor, 0), result.totalMinor);
  assert.equal(result.settlement.entries.reduce((s, e) => s + e.creditMinor, 0), result.totalMinor);
  await employee.put(base).set(...header).send({}).expect(403);
  await manager.post(`${base}/decision`).set(...header).send({ decision: 'reject', note: 'Too late to reject' }).expect(409);
});
test('claims keep their submitted accounting policy after an administrator changes it', async () => {
  const { claim } = await verified();
  const policy = await Policy.findOne().lean();
  const updated = { ...defaultPolicy, categories: defaultPolicy.categories.map(c => ({ ...c, account: `${c.account} UPDATED` })), version: policy.__v };
  await admin.put('/api/policy').set(...header).send(updated).expect(200);
  const result = await finance.post(`/api/claims/${claim._id}/settle`).set(...header).send({ date: today(), method: 'Cash', reference: 'VOUCHER-001' }).expect(200);
  assert.equal(result.body.settlement.entries[0].account, '6400 · Office supplies');
  assert.equal(result.body.settlement.entries.at(-1).account, '1010 · Cash');
  await admin.put('/api/policy').set(...header).send(updated).expect(409);
});
test('finance cannot verify its own claim and admin cannot disable an assigned manager', async () => {
  const { claim } = await draft(finance); const base = `/api/claims/${claim._id}`;
  await finance.post(`${base}/submit`).set(...header).send({}).expect(200);
  await manager.post(`${base}/decision`).set(...header).send({ decision: 'approve' }).expect(200);
  await finance.post(`${base}/decision`).set(...header).send({ decision: 'approve' }).expect(403);
  const managerView = users.manager.toObject();
  await admin.put(`/api/users/${users.manager._id}`).set(...header).send({ ...managerView, active: false }).expect(409);
  const audit = await admin.get('/api/audit').expect(200);
  assert.ok(audit.body.some(e => e.action === 'Reimbursement recorded'));
});
