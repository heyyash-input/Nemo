import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { rateLimit } from 'express-rate-limit';
import multer from 'multer';
import bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import mongoose from 'mongoose';
import { z } from 'zod';
import { User, Session, Claim, Receipt, Policy, AdminAudit } from './models.mjs';
import { claimInput, policyInput, id, roles, day, today, validatePolicy, journalEntries } from './domain.mjs';
import { registerSignup, passwordInput } from './signup.mjs';

class HttpError extends Error {
  constructor(status, message, details) { super(message); this.status = status; this.details = details; }
}
const fail = (status, message, details) => { throw new HttpError(status, message, details); };
const hash = value => createHash('sha256').update(value).digest('hex');
const userView = u => ({ _id: u._id, name: u.name, email: u.email, role: u.role, department: u.department, managerId: u.managerId, active: u.active });
const history = (user, action, note = '') => ({ actorId: user._id, actorName: user.name, role: user.role, action, note, at: new Date() });
const sameId = (a, b) => String(a?._id || a) === String(b?._id || b);
const populated = query => query.populate('ownerId', 'name email department').populate('managerId', 'name email');
const reference = prefix => `${prefix}-${new Date().getFullYear()}-${randomBytes(4).toString('hex').toUpperCase()}`;

export function createApp({ demo = false, origin = 'http://127.0.0.1:5173', production = false, mailer, otpSecret, allowedDomains = [], trustProxy = false } = {}) {
  const app = express();
  app.set('trust proxy', trustProxy);
  app.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: { directives: { 'img-src': ["'self'", 'data:', 'blob:'], 'style-src': ["'self'", "'unsafe-inline'"], 'font-src': ["'self'", 'data:'], 'script-src': ["'self'"], 'upgrade-insecure-requests': production ? [] : null } } }));
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      if (req.get('X-App-Request') !== 'ledgerly') return next(new HttpError(403, 'Missing application request header.'));
      if (req.get('Origin') && req.get('Origin') !== origin) return next(new HttpError(403, 'This request origin is not allowed.'));
    }
    next();
  });
  app.get('/api/health', (_req, res) => res.status(mongoose.connection.readyState === 1 ? 200 : 503).json({ status: mongoose.connection.readyState === 1 ? 'ok' : 'unavailable' }));
  app.get('/api/config', (_req, res) => res.json({ demo: demo && !production, signupAvailable: Boolean(mailer?.ready && otpSecret?.length >= 32), currency: 'INR' }));
  const cookieOptions = { httpOnly: true, sameSite: 'strict', secure: production, path: '/api', maxAge: 8 * 60 * 60 * 1000 };
  const loginLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false, message: { message: 'Too many login attempts. Please try again in 15 minutes.' } });
  async function signIn(user, req, res) {
    if (req.cookies.session) await Session.deleteOne({ tokenHash: hash(req.cookies.session) });
    const token = randomBytes(32).toString('hex');
    await Session.create({ userId: user._id, tokenHash: hash(token), expiresAt: new Date(Date.now() + cookieOptions.maxAge) });
    res.cookie('session', token, cookieOptions).json(userView(user));
  }
  registerSignup(app, { mailer, otpSecret, allowedDomains, signIn });
  app.post('/api/auth/login', loginLimit, async (req, res) => {
    const input = z.object({ email: z.email().max(200), password: z.string().min(1).max(128) }).parse(req.body);
    const user = await User.findOne({ email: input.email.toLowerCase(), active: true }).select('+passwordHash');
    if (!user || (production && user.email.endsWith('.demo')) || !await bcrypt.compare(input.password, user.passwordHash)) fail(401, 'Email or password is incorrect.');
    await signIn(user, req, res);
  });
  if (demo && !production) app.post('/api/auth/demo', loginLimit, async (req, res) => {
    const role = z.enum(roles).parse(req.body.role);
    const user = await User.findOne({ email: { $in: [`${role}@nemo.demo`, `${role}@ledgerly.demo`] }, active: true, role });
    if (!user) fail(404, 'This demo account is unavailable.');
    await signIn(user, req, res);
  });
  app.post('/api/auth/logout', async (req, res) => {
    if (req.cookies.session) await Session.deleteOne({ tokenHash: hash(req.cookies.session) });
    res.clearCookie('session', { ...cookieOptions, maxAge: undefined }).json({ ok: true });
  });
  app.use('/api', async (req, _res, next) => {
    const token = req.cookies.session;
    if (!token) return next(new HttpError(401, 'Please sign in to continue.'));
    const session = await Session.findOne({ tokenHash: hash(token), expiresAt: { $gt: new Date() } });
    const user = session && await User.findOne({ _id: session.userId, active: true });
    if (!user || (production && user.email.endsWith('.demo'))) return next(new HttpError(401, 'Your session has expired. Please sign in again.'));
    req.user = user;
    next();
  });
  const allow = (...allowed) => (req, _res, next) => allowed.includes(req.user.role) ? next() : next(new HttpError(403, 'You do not have access to this action.'));
  app.get('/api/auth/me', (req, res) => res.json(userView(req.user)));
  app.post('/api/auth/password', async (req, res) => {
    const input = z.object({ currentPassword: z.string().max(128), newPassword: passwordInput }).parse(req.body);
    const user = await User.findById(req.user._id).select('+passwordHash');
    if (!await bcrypt.compare(input.currentPassword, user.passwordHash)) fail(400, 'Current password is incorrect.');
    user.passwordHash = await bcrypt.hash(input.newPassword, 12);
    await user.save();
    await Session.deleteMany({ userId: user._id });
    res.clearCookie('session', { ...cookieOptions, maxAge: undefined }).json({ ok: true });
  });

  app.get('/api/policy', async (_req, res) => res.json(await Policy.findOne({ key: 'company' })));
  app.put('/api/policy', allow('admin'), async (req, res) => {
    const input = policyInput.parse(req.body);
    const version = z.number().int().nonnegative().parse(req.body.version);
    const policy = await Policy.findOneAndUpdate({ key: 'company', __v: version }, { $set: input, $inc: { __v: 1 } }, { new: true });
    if (!policy) fail(409, 'Policy changed since you opened it. Refresh and try again.');
    await AdminAudit.create({ actorId: req.user._id, actorName: req.user.name, action: 'Updated expense policy', detail: `Policy version ${policy.__v + 1}` });
    res.json(policy);
  });
  app.get('/api/users', allow('admin'), async (_req, res) => res.json(await User.find().sort({ name: 1 })));
  const userInput = z.object({ name: z.string().trim().min(2).max(100), email: z.email().max(200).transform(s => s.toLowerCase()), role: z.enum(roles), department: z.string().trim().min(2).max(80), managerId: id.nullish(), active: z.boolean().default(true) });
  async function checkManager(input, userId) {
    if (input.managerId) {
      if (sameId(input.managerId, userId)) fail(400, 'A user cannot be their own manager.');
      if (!await User.exists({ _id: input.managerId, role: 'manager', active: true })) fail(400, 'Choose an active manager.');
    }
    if (input.role === 'employee' && !input.managerId) fail(400, 'Employees need an assigned manager.');
  }
  app.post('/api/users', allow('admin'), async (req, res) => {
    const input = userInput.parse(req.body);
    const password = passwordInput.parse(req.body.password);
    await checkManager(input);
    const user = await User.create({ ...input, passwordHash: await bcrypt.hash(password, 12) });
    await AdminAudit.create({ actorId: req.user._id, actorName: req.user.name, action: 'Created user', detail: `${user.name} · ${user.role}` });
    res.status(201).json(userView(user));
  });
  app.put('/api/users/:id', allow('admin'), async (req, res) => {
    const userId = id.parse(req.params.id);
    const input = userInput.parse(req.body);
    if (sameId(userId, req.user._id) && (!input.active || input.role !== 'admin')) fail(400, 'You cannot deactivate yourself or remove your own administrator role.');
    await checkManager(input, userId);
    const existing = await User.findById(userId);
    if (!existing) fail(404, 'User not found.');
    if (existing.role === 'manager' && (input.role !== 'manager' || !input.active)) {
      if (await User.exists({ managerId: userId, active: true }) || await Claim.exists({ managerId: userId, status: 'submitted' })) fail(409, 'Reassign this manager’s employees and complete pending approvals first.');
    }
    const user = await User.findByIdAndUpdate(userId, { $set: input, ...(existing.email !== input.email ? { $unset: { emailVerifiedAt: 1 } } : {}) }, { new: true });
    await Session.deleteMany({ userId });
    await AdminAudit.create({ actorId: req.user._id, actorName: req.user.name, action: 'Updated user', detail: `${user.name} · ${user.role} · ${user.active ? 'active' : 'inactive'}` });
    res.json(userView(user));
  });

  function visibility(user) {
    if (user.role === 'admin' || user.role === 'finance') return { $or: [{ ownerId: user._id }, { status: { $ne: 'draft' } }] };
    if (user.role === 'manager') return { $or: [{ ownerId: user._id }, { managerId: user._id, status: { $ne: 'draft' } }] };
    return { ownerId: user._id };
  }
  async function getClaim(req) {
    const claim = await Claim.findOne({ _id: id.parse(req.params.id), ...visibility(req.user) });
    if (!claim) fail(404, 'Claim not found.');
    return claim;
  }
  app.get('/api/claims', async (req, res) => res.json(await populated(Claim.find(visibility(req.user)).sort({ updatedAt: -1 }))));
  app.get('/api/claims/:id', async (req, res) => {
    const claim = await getClaim(req);
    res.json(await populated(Claim.findById(claim._id)));
  });
  async function prepareItems(items, userId) {
    const receiptIds = items.map(i => i.receiptId).filter(Boolean);
    if (new Set(receiptIds).size !== receiptIds.length) fail(400, 'Attach a separate receipt to each expense line.');
    const receipts = await Receipt.find({ _id: { $in: receiptIds }, ownerId: userId });
    if (receipts.length !== receiptIds.length) fail(400, 'A receipt is missing or belongs to another user.');
    return items.map(item => ({ ...item, receiptName: receipts.find(r => sameId(r._id, item.receiptId))?.name }));
  }
  app.post('/api/claims', async (req, res) => {
    const input = claimInput.parse(req.body);
    const items = await prepareItems(input.items, req.user._id);
    const claim = await Claim.create({ ...input, items, ownerId: req.user._id, number: reference('EXP'), totalMinor: items.reduce((sum, item) => sum + item.amountMinor, 0), history: [history(req.user, 'Created draft')] });
    res.status(201).json(await populated(Claim.findById(claim._id)));
  });
  async function updateClaim(claim, set, event, expectedStatus = claim.status) {
    const updated = await Claim.findOneAndUpdate({ _id: claim._id, status: expectedStatus, __v: claim.__v }, { $set: set, ...(set.status === 'rejected' ? { $unset: { submittedReceiptIds: 1 } } : {}), $push: { history: event }, $inc: { __v: 1 } }, { new: true });
    if (!updated) fail(409, 'This claim changed while you were working. Refresh and try again.');
    return populated(Claim.findById(updated._id));
  }
  app.put('/api/claims/:id', async (req, res) => {
    const claim = await getClaim(req);
    if (!sameId(claim.ownerId, req.user._id) || !['draft', 'rejected'].includes(claim.status)) fail(403, 'Only the owner can edit a draft or rejected claim.');
    if (req.body.version !== claim.__v) fail(409, 'This claim has changed. Reopen it before editing.');
    const input = claimInput.parse(req.body);
    const items = await prepareItems(input.items, req.user._id);
    res.json(await updateClaim(claim, { ...input, items, status: 'draft', totalMinor: items.reduce((sum, i) => sum + i.amountMinor, 0) }, history(req.user, 'Updated draft')));
  });
  app.post('/api/claims/:id/submit', async (req, res) => {
    const claim = await getClaim(req);
    if (!sameId(claim.ownerId, req.user._id) || claim.status !== 'draft') fail(409, 'Only your own draft claims can be submitted.');
    const manager = await User.findOne({ _id: req.user.managerId, role: 'manager', active: true });
    if (!manager || sameId(manager._id, req.user._id)) fail(400, 'An administrator must assign you an active manager before submission.');
    const policy = await Policy.findOne({ key: 'company' }).lean();
    const problems = validatePolicy(claim, policy);
    if (problems.length) fail(422, 'Please resolve the policy checks before submitting.', problems);
    const receiptIds = claim.items.map(i => i.receiptId).filter(Boolean);
    if (receiptIds.length && await Claim.exists({ _id: { $ne: claim._id }, status: { $nin: ['draft', 'rejected'] }, 'items.receiptId': { $in: receiptIds } })) fail(422, 'A receipt is already attached to another submitted claim.');
    res.json(await updateClaim(claim, { status: 'submitted', managerId: manager._id, submittedAt: new Date(), policySnapshot: policy, ...(receiptIds.length ? { submittedReceiptIds: receiptIds } : {}) }, history(req.user, 'Submitted for approval')));
  });
  app.post('/api/claims/:id/decision', allow('manager', 'finance'), async (req, res) => {
    const input = z.object({ decision: z.enum(['approve', 'reject']), note: z.string().trim().max(1000).default('') }).parse(req.body);
    const claim = await getClaim(req);
    if (sameId(claim.ownerId, req.user._id)) fail(403, 'You cannot approve or verify your own claim.');
    const isManager = req.user.role === 'manager';
    if (isManager && (!sameId(claim.managerId, req.user._id) || claim.status !== 'submitted')) fail(409, 'This claim is not awaiting your manager approval.');
    if (!isManager && claim.status !== 'manager_approved') fail(409, 'Finance can verify only manager-approved claims.');
    if (input.decision === 'reject' && input.note.length < 5) fail(400, 'Explain the rejection in at least 5 characters.');
    const status = input.decision === 'reject' ? 'rejected' : isManager ? 'manager_approved' : 'finance_verified';
    const action = input.decision === 'reject' ? 'Rejected' : isManager ? 'Manager approved' : 'Finance verified';
    res.json(await updateClaim(claim, { status }, history(req.user, action, input.note)));
  });
  app.post('/api/claims/:id/settle', allow('finance'), async (req, res) => {
    const input = z.object({ date: day, method: z.enum(['Bank transfer', 'UPI', 'Cash']), reference: z.string().trim().min(3).max(100) }).parse(req.body);
    const claim = await getClaim(req);
    if (sameId(claim.ownerId, req.user._id)) fail(403, 'You cannot record your own reimbursement.');
    if (claim.status !== 'finance_verified') fail(409, 'Only finance-verified claims can be reimbursed, once.');
    if (input.date > today() || input.date < claim.submittedAt.toISOString().slice(0, 10)) fail(400, 'Reimbursement date must be between submission and today.');
    const settlement = { ...input, number: reference('TXN'), amountMinor: claim.totalMinor, currency: claim.currency, recordedBy: req.user.name, recordedAt: new Date(), entries: journalEntries(claim, input.method) };
    res.json(await updateClaim(claim, { status: 'reimbursed', settlement }, history(req.user, 'Reimbursement recorded', `${input.method} · ${input.reference}`)));
  });
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });
  app.post('/api/receipts', upload.single('receipt'), async (req, res) => {
    const file = req.file;
    if (!file) fail(400, 'Choose a receipt to upload.');
    const buffer = file.buffer;
    let mime;
    if (buffer.subarray(0, 5).toString() === '%PDF-') mime = 'application/pdf';
    else if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) mime = 'image/png';
    else if (buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) mime = 'image/jpeg';
    if (!mime) fail(400, 'Upload a PDF, PNG, or JPEG receipt, up to 5 MB.');
    const name = path.basename(file.originalname).replace(/[\r\n"\\]/g, '_').slice(0, 150);
    const receipt = await Receipt.create({ ownerId: req.user._id, name, mime, size: file.size, data: buffer });
    res.status(201).json({ _id: receipt._id, name, size: receipt.size });
  });
  app.get('/api/receipts/:id', async (req, res) => {
    const receiptId = id.parse(req.params.id);
    const receipt = await Receipt.findById(receiptId).select('+data');
    if (!receipt) fail(404, 'Receipt not found.');
    if (!sameId(receipt.ownerId, req.user._id) && !await Claim.exists({ ...visibility(req.user), 'items.receiptId': receiptId })) fail(404, 'Receipt not found.');
    res.set('Content-Type', receipt.mime).set('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(receipt.name)}`).send(receipt.data);
  });
  app.get('/api/audit', allow('admin'), async (_req, res) => {
    const [claims, admin] = await Promise.all([Claim.find().select('number history'), AdminAudit.find().sort({ createdAt: -1 }).limit(200)]);
    const events = [...claims.flatMap(c => c.history.map((h, index) => ({ _id: `${c._id}-${index}`, actorName: h.actorName, action: h.action, detail: `${c.number}${h.note ? ` · ${h.note}` : ''}`, createdAt: h.at }))), ...admin.map(a => a.toObject())];
    res.json(events.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 300));
  });
  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'API route not found.')));
  const dist = path.resolve('dist');
  if (existsSync(dist)) {
    app.use(express.static(dist));
    app.get('/{*path}', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }
  app.use((error, _req, res, _next) => {
    if (error instanceof z.ZodError) return res.status(400).json({ message: 'Please check the form fields.', details: error.issues.map(i => `${i.path.join('.') || 'Form'}: ${i.message}`) });
    if (error instanceof multer.MulterError) return res.status(400).json({ message: error.code === 'LIMIT_FILE_SIZE' ? 'Receipt must be smaller than 5 MB.' : 'Upload one receipt at a time.' });
    if (error.code === 11000) return res.status(409).json({ message: error.keyPattern?.submittedReceiptIds ? 'A receipt is already attached to another submitted claim.' : 'A record with these details already exists.' });
    const status = error.status || 500;
    if (status >= 500) console.error('request_failed', { name: error.name, code: error.code || 'INTERNAL_ERROR' });
    res.status(status).json({ message: status >= 500 ? 'An unexpected error occurred. Please try again.' : error.message, ...(error.details ? { details: error.details } : {}) });
  });
  return app;
}
