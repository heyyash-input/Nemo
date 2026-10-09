export type Role = 'employee' | 'manager' | 'finance' | 'admin';
export type Status = 'draft' | 'submitted' | 'manager_approved' | 'finance_verified' | 'reimbursed' | 'rejected';
export interface User { _id: string; name: string; email: string; role: Role; department: string; managerId?: string | null; active: boolean }
export interface Person { _id: string; name: string; email: string; department?: string }
export interface ExpenseItem { category: string; date: string; merchant: string; description: string; amountMinor: number; receiptId?: string | null; receiptName?: string }
export interface Policy { _id: string; __v: number; maxClaimMinor: number; receiptThresholdMinor: number; submissionWindowDays: number; categories: { name: string; limitMinor: number; account: string }[] }
export interface Settlement { number: string; date: string; method: string; reference: string; amountMinor: number; currency: string; recordedBy: string; recordedAt: string; entries: { account: string; debitMinor: number; creditMinor: number }[] }
export interface Claim { _id: string; __v: number; number: string; title: string; purpose: string; currency: string; ownerId: Person; managerId?: Person; status: Status; items: ExpenseItem[]; totalMinor: number; createdAt: string; updatedAt: string; submittedAt?: string; policySnapshot?: Policy; history: { action: string; actorName: string; role: Role; note?: string; at: string }[]; settlement?: Settlement }
export interface AuditEvent { _id: string; actorName: string; action: string; detail: string; createdAt: string }
