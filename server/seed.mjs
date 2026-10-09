import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { Claim, Policy, Receipt, User } from './models.mjs';
import { defaultPolicy, today, journalEntries } from './domain.mjs';

function receiptPdf(merchant, amount, date) {
  const content = `BT /F1 20 Tf 50 750 Td (DEMO RECEIPT) Tj /F1 12 Tf 0 -40 Td (${merchant}) Tj 0 -25 Td (Date: ${date}) Tj 0 -25 Td (Total: INR ${(amount / 100).toFixed(2)}) Tj 0 -40 Td (Sample document for college demonstration only.) Tj ET`;
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((obj, i) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf);
}
export async function initializePolicy() {
  await Policy.updateOne({ key: 'company' }, { $setOnInsert: defaultPolicy }, { upsert: true });
}
export async function seedDemo(local) {
  if (await User.exists({})) return;
  if (!local && !process.env.DEMO_PASSWORD) throw new Error('Set DEMO_PASSWORD before explicitly seeding an external demo database.');
  const password = process.env.DEMO_PASSWORD || `Demo-${randomBytes(8).toString('hex')}`;
  const passwordHash = await bcrypt.hash(password, 12);
  const manager = await User.create({ name: 'Ananya Rao', email: 'manager@nemo.demo', role: 'manager', department: 'Engineering', passwordHash });
  const employee = await User.create({ name: 'Yash Patil', email: 'employee@nemo.demo', role: 'employee', department: 'Engineering', managerId: manager._id, passwordHash });
  const finance = await User.create({ name: 'Rohan Mehta', email: 'finance@nemo.demo', role: 'finance', department: 'Finance', managerId: manager._id, passwordHash });
  await User.create({ name: 'Priya Shah', email: 'admin@nemo.demo', role: 'admin', department: 'Operations', managerId: manager._id, passwordHash });
  const colleague = await User.create({ name: 'Neha Desai', email: 'neha@nemo.demo', role: 'employee', department: 'Engineering', managerId: manager._id, passwordHash });
  const policy = await Policy.findOne({ key: 'company' }).lean();
  const dateAgo = days => new Date(Date.parse(today()) - days * 86400000).toISOString().slice(0, 10);
  const samples = [
    ['Client visit to Bengaluru', 'Travel', 'IndiGo', 845000, 'submitted', 2, employee],
    ['Product team lunch', 'Meals', 'The Good Bowl', 245000, 'manager_approved', 3, employee],
    ['Design software subscription', 'Software', 'Figma', 150000, 'finance_verified', 4, employee],
    ['Quarterly planning supplies', 'Office supplies', 'Office Depot', 320000, 'reimbursed', 8, employee],
    ['Conference hotel stay', 'Accommodation', 'The Fern', 680000, 'reimbursed', 12, employee],
    ['Customer workshop materials', 'Office supplies', 'Print Studio', 125000, 'draft', 1, employee],
    ['Project kickoff dinner', 'Meals', 'Social', 410000, 'rejected', 6, employee],
    ['On-site implementation visit', 'Travel', 'Indian Railways', 365000, 'submitted', 1, colleague],
    ['Research tools subscription', 'Software', 'Notion', 180000, 'manager_approved', 4, colleague],
  ];
  for (let index = 0; index < samples.length; index++) {
    const [title, category, merchant, amountMinor, status, days, owner] = samples[index];
    const date = dateAgo(days);
    const data = receiptPdf(merchant, amountMinor, date);
    const receipt = await Receipt.create({ ownerId: owner._id, name: `demo-receipt-${index + 1}.pdf`, mime: 'application/pdf', size: data.length, data });
    const event = (actor, action, offset, note = '') => ({ actorId: actor._id, actorName: actor.name, role: actor.role, action, note, at: new Date(`${dateAgo(Math.max(0, days - offset))}T09:00:00Z`) });
    const claim = {
      number: `EXP-${new Date().getFullYear()}-${String(index + 1001)}`, ownerId: owner._id, managerId: manager._id,
      title, purpose: `${title} for the current engineering project. Demo claim for the PBL presentation.`, currency: 'INR', status,
      items: [{ category, merchant, date, amountMinor, description: 'Business expense', receiptId: receipt._id, receiptName: receipt.name }],
      totalMinor: amountMinor, policySnapshot: policy, history: [event(owner, 'Created draft', 0)],
      createdAt: new Date(`${date}T09:00:00Z`), updatedAt: new Date(`${dateAgo(Math.max(0, days - 2))}T09:00:00Z`),
    };
    if (status !== 'draft') { claim.submittedAt = new Date(`${date}T09:00:00Z`); claim.history.push(event(owner, 'Submitted for approval', 0)); }
    if (!['draft', 'rejected'].includes(status)) claim.submittedReceiptIds = [receipt._id];
    if (['manager_approved', 'finance_verified', 'reimbursed'].includes(status)) claim.history.push(event(manager, 'Manager approved', 1, 'Business purpose and receipt verified.'));
    if (['finance_verified', 'reimbursed'].includes(status)) claim.history.push(event(finance, 'Finance verified', 2, 'Ready for reimbursement.'));
    if (status === 'rejected') claim.history.push(event(manager, 'Rejected', 1, 'Meal amount exceeds the per-line policy limit. Please correct the claim.'));
    if (status === 'reimbursed') {
      claim.settlement = { number: `TXN-${new Date().getFullYear()}-${index + 1001}`, date: dateAgo(days - 3), method: 'Bank transfer', reference: `DEMO-NEFT-${index + 1001}`, amountMinor, currency: 'INR', recordedBy: finance.name, recordedAt: new Date(`${dateAgo(days - 3)}T09:00:00Z`), entries: journalEntries(claim, 'Bank transfer') };
      claim.history.push(event(finance, 'Reimbursement recorded', 3, claim.settlement.reference));
    }
    await Claim.create(claim);
  }
  await mkdir('.data', { recursive: true });
  await writeFile('.data/demo-credentials.txt', `LOCAL DEMO ACCOUNTS ONLY\nPassword: ${password}\n\nemployee@nemo.demo\nmanager@nemo.demo\nfinance@nemo.demo\nadmin@nemo.demo\n`, { mode: 0o600 });
  console.log('Demo records created. Credentials saved to .data/demo-credentials.txt.');
}
