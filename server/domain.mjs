import { z } from 'zod';
export const id = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid record ID');
export const roles = ['employee', 'manager', 'finance', 'admin'];
export const money = z.number().int().min(1).max(100000000);
export const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').refine(v => {
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}, 'Invalid calendar date');
export const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
export const claimInput = z.object({
  title: z.string().trim().min(3).max(100),
  purpose: z.string().trim().min(5).max(1500),
  items: z.array(z.object({
    category: z.string().trim().min(1).max(60),
    date: day,
    merchant: z.string().trim().min(2).max(100),
    description: z.string().trim().max(300).default(''),
    amountMinor: money,
    receiptId: id.nullish(),
  })).min(1).max(20),
});
export const policyInput = z.object({
  maxClaimMinor: money,
  receiptThresholdMinor: z.number().int().min(0).max(100000000),
  submissionWindowDays: z.number().int().min(1).max(365),
  categories: z.array(z.object({
    name: z.string().trim().min(2).max(60),
    limitMinor: money,
    account: z.string().trim().min(3).max(100),
  })).min(1).max(20),
}).refine(p => new Set(p.categories.map(c => c.name.toLowerCase())).size === p.categories.length, 'Category names must be unique');
export const defaultPolicy = {
  maxClaimMinor: 10000000,
  receiptThresholdMinor: 0,
  submissionWindowDays: 60,
  categories: [
    { name: 'Travel', limitMinor: 5000000, account: '6100 · Travel expenses' },
    { name: 'Meals', limitMinor: 300000, account: '6200 · Meals & entertainment' },
    { name: 'Accommodation', limitMinor: 1500000, account: '6300 · Accommodation' },
    { name: 'Office supplies', limitMinor: 1000000, account: '6400 · Office supplies' },
    { name: 'Software', limitMinor: 2500000, account: '6500 · Software subscriptions' },
    { name: 'Other', limitMinor: 500000, account: '6900 · Other business expenses' },
  ],
};
export function validatePolicy(claim, policy, currentDay = today()) {
  const problems = [];
  if (claim.totalMinor > policy.maxClaimMinor) problems.push('Claim total exceeds the company limit.');
  claim.items.forEach((item, index) => {
    const label = `Line ${index + 1}`;
    const category = policy.categories.find(c => c.name === item.category);
    if (!category) problems.push(`${label}: category is not allowed by the current policy.`);
    else if (item.amountMinor > category.limitMinor) problems.push(`${label}: amount exceeds the ${category.name} limit.`);
    if (item.amountMinor > policy.receiptThresholdMinor && !item.receiptId) problems.push(`${label}: a receipt is required.`);
    const age = (Date.parse(currentDay) - Date.parse(item.date)) / 86400000;
    if (age < 0) problems.push(`${label}: expense date cannot be in the future.`);
    if (age > policy.submissionWindowDays) problems.push(`${label}: expense is outside the ${policy.submissionWindowDays}-day submission window.`);
  });
  return problems;
}
export function journalEntries(claim, method) {
  const accounts = new Map();
  for (const item of claim.items) {
    const category = claim.policySnapshot.categories.find(c => c.name === item.category);
    if (!category) throw new Error('Submitted claim has no matching accounting category.');
    accounts.set(category.account, (accounts.get(category.account) || 0) + item.amountMinor);
  }
  return [...accounts].map(([account, debitMinor]) => ({ account, debitMinor, creditMinor: 0 })).concat([
    { account: method === 'Cash' ? '1010 · Cash' : '1020 · Bank', debitMinor: 0, creditMinor: claim.totalMinor },
  ]);
}
