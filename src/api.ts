export class ApiError extends Error {
  /** Keep the API status and validation details with the error message. */
  constructor(
    message: string,
    public status: number,
    public details: string[] = [],
  ) {
    super(message);
  }
}
/** Send an API request with the session cookie and convert failed responses into ApiError. */
export async function api<T>(url: string, options: RequestInit = {}): Promise<T> {
  const isForm = options.body instanceof FormData;
  const response = await fetch(`/api${url}`, {
    credentials: 'same-origin',
    ...options,
    headers: {
      'X-App-Request': 'ledgerly',
      ...(!isForm && options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 401 && !url.startsWith('/auth/'))
      window.dispatchEvent(new Event('session-expired'));
    throw new ApiError(
      data.message || 'The request could not be completed.',
      response.status,
      data.details,
    );
  }
  return data;
}
/** Send a JSON POST request, usually to create a record or perform an action. */
export const post = <T>(url: string, body: unknown = {}) =>
  api<T>(url, { method: 'POST', body: JSON.stringify(body) });
/** Send a JSON PUT request to update an existing record. */
export const put = <T>(url: string, body: unknown) =>
  api<T>(url, { method: 'PUT', body: JSON.stringify(body) });
/** Turn an unknown error into a readable message, including API validation details. */
export function errorText(error: unknown): string {
  if (error instanceof ApiError) {
    return [error.message, ...error.details].join(' ');
  }
  if (error instanceof Error) {
    return error.message;
  }
  return 'Something went wrong.';
}
/** Display an integer amount in paise as formatted Indian rupees. */
export const money = (minor: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: minor % 100 === 0 ? 0 : 2,
  }).format(minor / 100);
/** Format a date for display, keeping calendar dates on their original day. */
export function dateLabel(date?: string): string {
  if (!date) return '—';
  // Calendar dates use local midnight so timezone conversion cannot shift the day.
  const dateWithTime = date.length === 10 ? `${date}T00:00:00` : date;
  return new Date(dateWithTime).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}
/** Return today in India as YYYY-MM-DD for expense dates. */
export const today = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
/** Download CSV data with escaped quotes and spreadsheet formula protection. */
export function exportCsv(filename: string, rows: (string | number)[][]) {
  const csv = rows
    .map(
      /* Join escaped CSV cells into one row. */ (row) =>
        row
          .map(
            /* Escape a CSV cell and neutralize spreadsheet formula prefixes. */ (value) => {
              let cell = String(value);
              if (/^[=+@\-\t\r]/.test(cell)) cell = `'${cell}`;
              return `"${cell.replace(/"/g, '""')}"`;
            },
          )
          .join(','),
    )
    .join('\r\n');
  const url = URL.createObjectURL(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8;' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(
    /* Release the temporary download URL after the browser has used it. */ () =>
      URL.revokeObjectURL(url),
    1000,
  );
}
