export class ApiError extends Error {
  constructor(message: string, public status: number, public details: string[] = []) { super(message); }
}
export async function api<T>(url: string, options: RequestInit = {}): Promise<T> {
  const isForm = options.body instanceof FormData;
  const response = await fetch(`/api${url}`, { credentials: 'same-origin', ...options, headers: { 'X-App-Request': 'ledgerly', ...(!isForm && options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers } });
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 401 && !url.startsWith('/auth/')) window.dispatchEvent(new Event('session-expired'));
    throw new ApiError(data.message || 'The request could not be completed.', response.status, data.details);
  }
  return data;
}
export const post = <T>(url: string, body: unknown = {}) => api<T>(url, { method: 'POST', body: JSON.stringify(body) });
export const put = <T>(url: string, body: unknown) => api<T>(url, { method: 'PUT', body: JSON.stringify(body) });
export const errorText = (error: unknown) => error instanceof ApiError ? [error.message, ...error.details].join(' ') : error instanceof Error ? error.message : 'Something went wrong.';
export const money = (minor: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: minor % 100 === 0 ? 0 : 2 }).format(minor / 100);
export const dateLabel = (date?: string) => date ? new Date(date.length === 10 ? `${date}T00:00:00` : date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
export const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
export function exportCsv(filename: string, rows: (string | number)[][]) {
  const csv = rows.map(row => row.map(value => {
    let cell = String(value);
    if (/^[=+@\-\t\r]/.test(cell)) cell = `'${cell}`;
    return `"${cell.replace(/"/g, '""')}"`;
  }).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8;' }));
  const link = document.createElement('a'); link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
