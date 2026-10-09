import mongoose from 'mongoose';
const { Schema, model } = mongoose;
const ref = (name) => ({ type: Schema.Types.ObjectId, ref: name });

const userSchema = new Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true, lowercase: true },
  passwordHash: { type: String, required: true, select: false },
  role: { type: String, enum: ['employee', 'manager', 'finance', 'admin'], required: true },
  department: { type: String, required: true },
  managerId: ref('User'),
  active: { type: Boolean, default: true },
  emailVerifiedAt: Date,
}, { timestamps: true });
export const User = model('User', userSchema);
export const Session = model('Session', new Schema({
  tokenHash: { type: String, unique: true, required: true },
  userId: { ...ref('User'), required: true },
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
}));

export const SignupChallenge = model('SignupChallenge', new Schema({
  email: { type: String, required: true, unique: true },
  name: String,
  department: String,
  passwordHash: { type: String, select: false },
  challengeHash: { type: String, required: true, unique: true },
  otpHash: { type: String, required: true, select: false },
  attempts: { type: Number, default: 0 },
  sentAt: { type: Date, required: true },
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
}));

const policySchema = new Schema({
  key: { type: String, unique: true, default: 'company' },
  maxClaimMinor: { type: Number, required: true },
  receiptThresholdMinor: { type: Number, required: true },
  submissionWindowDays: { type: Number, required: true },
  categories: [{ _id: false, name: String, limitMinor: Number, account: String }],
}, { timestamps: true, optimisticConcurrency: true });
export const Policy = model('Policy', policySchema);
export const Receipt = model('Receipt', new Schema({
  ownerId: { ...ref('User'), required: true },
  name: String, mime: String, size: Number,
  data: { type: Buffer, select: false },
}, { timestamps: true }));

const claimSchema = new Schema({
  number: { type: String, unique: true, required: true },
  ownerId: { ...ref('User'), required: true, index: true },
  managerId: ref('User'),
  title: { type: String, required: true },
  purpose: { type: String, required: true },
  currency: { type: String, default: 'INR', enum: ['INR'] },
  status: { type: String, enum: ['draft', 'submitted', 'manager_approved', 'finance_verified', 'reimbursed', 'rejected'], default: 'draft', index: true },
  items: [{ _id: false, category: String, date: String, merchant: String, description: String, amountMinor: Number, receiptId: ref('Receipt'), receiptName: String }],
  totalMinor: { type: Number, required: true },
  policySnapshot: Schema.Types.Mixed,
  submittedAt: Date,
  submittedReceiptIds: { type: [Schema.Types.ObjectId], default: undefined, select: false },
  history: [{ _id: false, action: String, actorId: ref('User'), actorName: String, role: String, note: String, at: { type: Date, default: Date.now } }],
  settlement: {
    type: new Schema({
      number: String, date: String, method: String, reference: String,
      amountMinor: Number, currency: String, recordedBy: String, recordedAt: Date,
      entries: [{ _id: false, account: String, debitMinor: Number, creditMinor: Number }],
    }, { _id: false }),
    default: undefined,
  },
}, { timestamps: true });
claimSchema.index({ submittedReceiptIds: 1 }, { unique: true, sparse: true });
export const Claim = model('Claim', claimSchema);
export const AdminAudit = model('AdminAudit', new Schema({
  actorId: ref('User'), actorName: String, action: String, detail: String,
}, { timestamps: true }));
