import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const compiled = ts.transpileModule(fs.readFileSync('src/api.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
let api, context, requests, events, downloads, response;
beforeEach(
  /* Load real frontend utilities with mock network and browser download APIs. */ () => {
    requests = [];
    events = [];
    downloads = {};
    response = {
      ok: true,
      status: 200,
      json: /* Return the configured fake API payload. */ async () => ({ ok: true }),
    };
    const exports = {};
    context = vm.createContext({
      exports,
      Error,
      FormData,
      Blob,
      Event,
      fetch: /* Capture request options without contacting a server. */ async (url, options) => {
        requests.push({ url, options });
        return response;
      },
      window: {
        dispatchEvent: /* Capture session-expired browser events. */ (event) =>
          events.push(event.type),
      },
      document: {
        createElement: /* Return a fake download link. */ () => ({
          click: /* Capture the clicked filename and URL. */ function () {
            downloads.link = { href: this.href, download: this.download };
          },
        }),
      },
      URL: {
        createObjectURL: /* Capture the generated CSV blob. */ (blob) => {
          downloads.blob = blob;
          return 'blob:test';
        },
        revokeObjectURL: /* Capture release of the temporary URL. */ (url) => {
          downloads.revoked = url;
        },
      },
      setTimeout: /* Run cleanup immediately in this unit test. */ (callback) => callback(),
    });
    vm.runInContext(compiled, context);
    api = exports;
  },
);

test('frontend API service sends JSON, credentials, and application headers', /* Verify request helpers serialize writes and return server data. */ async () => {
  assert.equal((await api.post('/claims', { title: 'Example' })).ok, true);
  assert.equal(requests[0].url, '/api/claims');
  assert.equal(requests[0].options.credentials, 'same-origin');
  assert.equal(requests[0].options.headers['X-App-Request'], 'ledgerly');
  assert.equal(requests[0].options.headers['Content-Type'], 'application/json');
  assert.equal(requests[0].options.body, JSON.stringify({ title: 'Example' }));
  await api.put('/policy', { version: 2 });
  assert.equal(requests[1].options.method, 'PUT');
});

test('frontend upload service lets the browser set multipart boundaries', /* Confirm FormData uploads do not receive a JSON content type. */ async () => {
  const form = new FormData();
  form.append('receipt', new Blob(['test']), 'receipt.pdf');
  await api.api('/receipts', { method: 'POST', body: form });
  assert.equal(requests[0].options.body, form);
  assert.equal(requests[0].options.headers['Content-Type'], undefined);
});

test('frontend errors include validation details and signal session expiry correctly', /* Cover error display and protected-route session-expired events. */ async () => {
  response = {
    ok: false,
    status: 401,
    json: /* Return an expired-session response. */ async () => ({
      message: 'Session expired',
      details: ['Sign in again'],
    }),
  };
  await assert.rejects(
    /* Request a protected endpoint with the expired session. */ () => api.api('/claims'),
    /* Check the structured error and its visible message. */ (error) => {
      assert.equal(error.status, 401);
      assert.equal(api.errorText(error), 'Session expired Sign in again');
      return true;
    },
  );
  assert.deepEqual(events, ['session-expired']);
  await assert.rejects(
    /* Login failures must not trigger a second expiry event. */ () => api.post('/auth/login', {}),
  );
  assert.equal(events.length, 1);
  assert.equal(api.errorText(new Error('Network error')), 'Network error');
  assert.equal(api.errorText(null), 'Something went wrong.');
});

test('display utilities format rupees, calendar dates, and the India date', /* Check paise conversion and stable date labels. */ () => {
  assert.equal(api.money(12345), '₹123.45');
  assert.equal(api.money(10000), '₹100');
  assert.equal(api.dateLabel(), '—');
  assert.match(api.dateLabel('2026-10-26'), /26.*Oct.*2026/);
  const expected = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  assert.equal(api.today(), expected);
});

test('CSV service escapes cells, neutralizes formulas, and releases download URLs', /* Verify generated file content and browser download cleanup. */ async () => {
  api.exportCsv('claims.csv', [
    ['Title', 'Amount'],
    ['A "quoted", title', 123],
    ['=1+1', '+SUM(A1)'],
    ['@name', '-10'],
  ]);
  const csv = await downloads.blob.text();
  assert.ok(csv.includes('"A ""quoted"", title","123"'));
  assert.ok(csv.includes('"\'=1+1","\'+SUM(A1)"'));
  assert.ok(csv.includes('"\'@name","\'-10"'));
  const bytes = new Uint8Array(await downloads.blob.arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 3)], [239, 187, 191]);
  assert.equal(downloads.link.download, 'claims.csv');
  assert.equal(downloads.revoked, 'blob:test');
});
