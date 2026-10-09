import { Alert, Button, CircularProgress, Table, TableBody, TableCell, TableContainer, TableHead, TableRow } from '@mui/material';
import { ArrowUpRight, FileText, Receipt, Plane, Utensils, BedDouble, Monitor, Package, MoreHorizontal } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { Claim, Status } from './types';
import { money, dateLabel } from './api';

export const statusLabels: Record<Status, string> = { draft: 'Draft', submitted: 'Awaiting approval', manager_approved: 'Finance review', finance_verified: 'Ready to pay', reimbursed: 'Reimbursed', rejected: 'Rejected' };
export function StatusBadge({ status }: { status: Status }) { return <span className={`status-badge ${status}`}><span />{statusLabels[status]}</span>; }
export function CategoryIcon({ category, size = 18 }: { category: string; size?: number }) {
  const Icon = ({ Travel: Plane, Meals: Utensils, Accommodation: BedDouble, Software: Monitor, 'Office supplies': Package } as Record<string, typeof Plane>)[category] || MoreHorizontal;
  return <Icon size={size} strokeWidth={1.7} />;
}
export function Loading() { return <div className="loading"><CircularProgress size={28} /><span>Loading your workspace…</span></div>; }
export function Empty({ title, text, action }: { title: string; text: string; action?: React.ReactNode }) { return <div className="empty-state"><div className="empty-icon"><Receipt size={28} /></div><h3>{title}</h3><p>{text}</p>{action}</div>; }
export function ErrorNotice({ error }: { error: string }) { return error ? <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert> : null; }
export function PageHeading({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description: string; action?: React.ReactNode }) { return <div className="page-heading"><div>{eyebrow && <div className="eyebrow">{eyebrow}</div>}<h1>{title}</h1><p>{description}</p></div><div className="heading-actions">{action}</div></div>; }
export function ClaimTable({ claims, showEmployee = false }: { claims: Claim[]; showEmployee?: boolean }) {
  const navigate = useNavigate();
  if (!claims.length) return <Empty title="No expenses here yet" text="Claims matching this view will appear here." />;
  return <TableContainer><Table aria-label="Expense claims"><TableHead><TableRow><TableCell>Expense details</TableCell>{showEmployee && <TableCell>Employee</TableCell>}<TableCell>Submitted</TableCell><TableCell>Status</TableCell><TableCell align="right">Amount</TableCell><TableCell><span className="sr-only">Open claim</span></TableCell></TableRow></TableHead><TableBody>{claims.map(claim => <TableRow key={claim._id} hover><TableCell><div className="expense-title"><span className={`category-icon cat-${claim.items[0]?.category.replaceAll(' ', '-').toLowerCase()}`}><CategoryIcon category={claim.items[0]?.category || 'Other'} /></span><div><button className="text-link claim-link" onClick={() => navigate(`/expenses/${claim._id}`)}>{claim.title}</button><span className="cell-secondary">{claim.number} <span className="dot">·</span> {claim.items.length > 1 ? `${claim.items.length} items` : claim.items[0]?.category}</span></div></div></TableCell>{showEmployee && <TableCell>{claim.ownerId.name}<span className="cell-secondary">{claim.ownerId.department}</span></TableCell>}<TableCell className="nowrap">{dateLabel(claim.submittedAt || claim.createdAt)}</TableCell><TableCell><StatusBadge status={claim.status} /></TableCell><TableCell align="right"><strong className="amount">{money(claim.totalMinor)}</strong></TableCell><TableCell><Button size="small" aria-label={`Open ${claim.title}`} onClick={() => navigate(`/expenses/${claim._id}`)} sx={{ minWidth: 28, p: 0.5 }}><ArrowUpRight size={17} /></Button></TableCell></TableRow>)}</TableBody></Table></TableContainer>;
}
export function ReceiptLink({ id, name }: { id?: string | null; name?: string }) { return id ? <a className="receipt-link" href={`/api/receipts/${id}`} target="_blank" rel="noreferrer"><FileText size={15} />{name || 'Download receipt'}</a> : <span className="muted">No receipt</span>; }
