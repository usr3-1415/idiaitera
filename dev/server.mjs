// Τοπικός server για δοκιμές χωρίς Google λογαριασμό.
// Σερβίρει το frontend (docs/) και τρέχει το ΠΡΑΓΜΑΤΙΚΟ backend/Code.gs πάνω σε
// in-memory ψεύτικο Google Sheet στο /api.
//
//   node dev/server.mjs          → http://localhost:8787
//   PIN=1234 DELAY=800 PORT=8787 (προαιρετικά)

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 8787);
const PIN = process.env.PIN || '1234';
const DELAY = Number(process.env.DELAY || 400); // ψεύτικη καθυστέρηση δικτύου, για να φαίνεται το optimistic UI

// ---------------------------------------------------------------------------
// Fake Apps Script services: μόνο ό,τι χρησιμοποιεί το Code.gs.

// Όπως το Sheets: απόστροφος στην αρχή σημαίνει "κείμενο" και δεν αποθηκεύεται.
const cellInput = (v) => (typeof v === 'string' && v.startsWith("'") ? v.slice(1) : v);

class FakeRange {
  constructor(sheet, row, col, rows, cols) { Object.assign(this, { sheet, row, col, rows, cols }); }
  getValues() {
    return Array.from({ length: this.rows }, (_, r) =>
      Array.from({ length: this.cols }, (_, c) => this.sheet.data[this.row - 1 + r]?.[this.col - 1 + c] ?? ''));
  }
  getValue() { return this.getValues()[0][0]; }
  setValues(values) {
    values.forEach((rowVals, r) => {
      const row = (this.sheet.data[this.row - 1 + r] ||= []);
      rowVals.forEach((v, c) => { row[this.col - 1 + c] = cellInput(v); });
    });
    return this;
  }
  setValue(v) { return this.setValues([[v]]); }
  setNumberFormat() { return this; }
  setFontWeight() { return this; }
}

class FakeSheet {
  constructor(ss, name) { this.ss = ss; this.name = name; this.data = []; }
  getRange(a, b, c = 1, d = 1) {
    if (typeof a === 'string') return new FakeRange(this, 1, 1, 1, 1); // A1 notation: μόνο για formats
    return new FakeRange(this, a, b, c, d);
  }
  getLastRow() { return this.data.length; }
  appendRow(values) { this.data.push(values.map(cellInput)); }
  deleteRow(row) { this.data.splice(row - 1, 1); }
  setFrozenRows() {}
  getParent() { return this.ss; }
}

const spreadsheet = {
  sheets: new Map(),
  getSheetByName(name) { return this.sheets.get(name) || null; },
  insertSheet(name) { const s = new FakeSheet(this, name); this.sheets.set(name, s); return s; },
  getSpreadsheetTimeZone() { return 'Europe/Athens'; },
};

const props = new Map();
const cacheStore = new Map();
const sandbox = {
  SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet },
  PropertiesService: {
    getScriptProperties: () => ({
      getProperty: (k) => props.get(k) ?? null,
      setProperty: (k, v) => props.set(k, String(v)),
    }),
  },
  CacheService: {
    getScriptCache: () => ({
      get: (k) => cacheStore.get(k) ?? null,
      put: (k, v, ttl) => { cacheStore.set(k, v); setTimeout(() => cacheStore.delete(k), ttl * 1000).unref(); },
    }),
  },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  Utilities: {
    getUuid: () => crypto.randomUUID(),
    formatDate: (d) => d.toISOString().slice(0, 10),
  },
  ContentService: {
    MimeType: { JSON: 'application/json' },
    createTextOutput: (text) => ({ text, setMimeType() { return this; } }),
  },
  Logger: { log: (...a) => console.log('[gas]', ...a) },
  console,
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'backend/Code.gs'), 'utf8'), sandbox, { filename: 'Code.gs' });
sandbox.setup();
props.set('PIN', PIN);

// ---------------------------------------------------------------------------
// HTTP

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml',
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/api') {
    let body = '';
    for await (const chunk of req) body += chunk;
    await new Promise((r) => setTimeout(r, DELAY));
    const out = req.method === 'POST'
      ? sandbox.doPost({ postData: { contents: body } })
      : sandbox.doGet({ parameter: Object.fromEntries(url.searchParams) });
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(out.text);
    return;
  }

  const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
  const file = path.join(ROOT, 'docs', rel);
  if (!file.startsWith(path.join(ROOT, 'docs')) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404).end('Not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
});

server.listen(PORT, () => {
  console.log(`Ταμείο dev server: http://localhost:${PORT}/#api=http://localhost:${PORT}/api&pin=${PIN}`);
});
