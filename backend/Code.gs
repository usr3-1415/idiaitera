/**
 * Ταμείο Ιδιαίτερων: backend σε Google Apps Script.
 *
 * Το Google Sheet λειτουργεί ως ledger κινήσεων (φύλλο "Transactions").
 *
 * Endpoints (όλα στο URL του Web App, .../exec):
 *   GET  ?action=list&pin=XXXX                          → { ok, transactions, balance }
 *   POST {"pin":"XXXX","action":"create","tx":{...}}    → { ok, transaction, transactions, balance }
 *   POST {"pin":"XXXX","action":"update","tx":{...}}    → { ok, transaction, transactions, balance }
 *   POST {"pin":"XXXX","action":"delete","id":"..."}    → { ok, transactions, balance }
 *
 * Το Apps Script δεν υποστηρίζει paths (/api/transactions) ούτε PUT/DELETE,
 * γι' αυτό η ενέργεια δηλώνεται με το πεδίο `action`.
 * Τα σφάλματα επιστρέφονται ως { ok: false, error: <code>, message }.
 *
 * Όλες οι εγγραφές είναι idempotent (το id το δίνει ο client), ώστε το
 * frontend να μπορεί να ξαναστείλει με ασφάλεια ό,τι είχε μείνει σε αναμονή
 * χωρίς σύνδεση.
 */

const SHEET_NAME = 'Transactions';
const HEADERS = ['id', 'timestamp', 'date', 'type', 'category', 'amount', 'created_by', 'notes'];
const COL = HEADERS.reduce(function (m, h, i) { m[h] = i; return m; }, {});
const TYPES = ['DEPOSIT', 'EXPENSE'];
const MAX_FAILED_PINS = 10;
const LOCKOUT_SECONDS = 600;

/**
 * Τρέξ' το μία φορά από τον editor (Run → setup). Δημιουργεί το φύλλο με
 * τις επικεφαλίδες και ορίζει τυχαίο PIN, αν δεν υπάρχει ήδη.
 */
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
  sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold');
  sheet.setFrozenRows(1);
  // Όλες οι στήλες εκτός από το ποσό είναι κείμενο. Έτσι το Sheets δεν
  // μετατρέπει ημερομηνίες και ids και δεν εκτελεί τύπους από σημειώσεις.
  ['A:E', 'G:H'].forEach(function (a1) { sheet.getRange(a1).setNumberFormat('@'); });
  sheet.getRange('F:F').setNumberFormat('0.00');

  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('PIN')) {
    props.setProperty('PIN', String(Math.floor(100000 + Math.random() * 900000)));
  }
  Logger.log('Έτοιμο. PIN: ' + props.getProperty('PIN') +
    ' (αλλάζει από Project Settings → Script properties)');
}

function doGet(e) {
  return respond_(function () {
    const p = (e && e.parameter) || {};
    checkPin_(p.pin);
    if ((p.action || 'list') !== 'list') throw apiError_('bad_action', 'Άγνωστη ενέργεια');
    return withLock_(function () { return snapshot_(getSheet_()); });
  });
}

function doPost(e) {
  return respond_(function () {
    let body;
    try {
      body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    } catch (err) {
      throw apiError_('bad_json', 'Μη έγκυρο JSON');
    }
    checkPin_(body.pin);
    return withLock_(function () {
      const sheet = getSheet_();
      switch (body.action) {
        case 'create':
          return Object.assign({ transaction: createTx_(sheet, body.tx) }, snapshot_(sheet));
        case 'update':
          return Object.assign({ transaction: updateTx_(sheet, body.tx) }, snapshot_(sheet));
        case 'delete':
          deleteTx_(sheet, body.id);
          return snapshot_(sheet);
        default:
          throw apiError_('bad_action', 'Άγνωστη ενέργεια');
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Ledger operations

function createTx_(sheet, input) {
  const tx = cleanTx_(input);
  // Επανάληψη αποστολής για κίνηση που έχει ήδη αποθηκευτεί: δεν τη διπλογράφουμε.
  if (findRow_(sheet, tx.id) > 0) return tx;
  tx.timestamp = validTimestamp_(input.timestamp) || new Date().toISOString();
  sheet.appendRow(toRow_(tx));
  return tx;
}

function updateTx_(sheet, input) {
  const tx = cleanTx_(input);
  const row = findRow_(sheet, tx.id);
  if (row < 0) throw apiError_('not_found', 'Η κίνηση δεν βρέθηκε (ίσως έχει διαγραφεί).');
  const tz = sheet.getParent().getSpreadsheetTimeZone();
  const current = rowToTx_(sheet.getRange(row, 1, 1, HEADERS.length).getValues()[0], tz);
  tx.timestamp = current.timestamp; // κρατάμε την αρχική ώρα καταχώρησης
  sheet.getRange(row, 1, 1, HEADERS.length).setValues([toRow_(tx)]);
  return tx;
}

function deleteTx_(sheet, id) {
  const row = findRow_(sheet, String(id || ''));
  if (row > 0) sheet.deleteRow(row); // αν δεν υπάρχει, έχει ήδη διαγραφεί
}

/** Όλες οι κινήσεις (νεότερες πρώτα) και το τρέχον υπόλοιπο. */
function snapshot_(sheet) {
  const tz = sheet.getParent().getSpreadsheetTimeZone();
  const txs = [];
  readRows_(sheet).forEach(function (row, i) {
    if (row.every(function (v) { return v === '' || v === null; })) return;
    // Γραμμές που προστέθηκαν με το χέρι στο Sheet παίρνουν id για να
    // μπορούν να διορθωθούν από την εφαρμογή.
    if (!row[COL.id]) {
      row[COL.id] = Utilities.getUuid();
      sheet.getRange(i + 2, COL.id + 1).setValue(row[COL.id]);
    }
    txs.push(rowToTx_(row, tz));
  });
  txs.sort(function (a, b) {
    return b.date.localeCompare(a.date) || b.timestamp.localeCompare(a.timestamp);
  });
  return { transactions: txs, balance: balanceOf_(txs) };
}

/** Current Balance = SUM(DEPOSITS) - SUM(EXPENSES), σε λεπτά για να αποφύγουμε σφάλματα στρογγυλοποίησης. */
function balanceOf_(txs) {
  const cents = txs.reduce(function (sum, t) {
    const sign = t.type === 'DEPOSIT' ? 1 : t.type === 'EXPENSE' ? -1 : 0;
    return sum + sign * Math.round(t.amount * 100);
  }, 0);
  return cents / 100;
}

// ---------------------------------------------------------------------------
// Sheet helpers

function getSheet_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  if (!sheet) throw apiError_('not_configured', 'Δεν βρέθηκε το φύλλο. Τρέξε πρώτα τη setup() στο Apps Script.');
  return sheet;
}

function readRows_(sheet) {
  const last = sheet.getLastRow();
  if (last < 2) return [];
  return sheet.getRange(2, 1, last - 1, HEADERS.length).getValues();
}

/** Αριθμός γραμμής (1-based) της κίνησης με αυτό το id, ή -1. */
function findRow_(sheet, id) {
  const last = sheet.getLastRow();
  if (!id || last < 2) return -1;
  const ids = sheet.getRange(2, COL.id + 1, last - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === id) return i + 2;
  }
  return -1;
}

function rowToTx_(row, tz) {
  const ts = row[COL.timestamp];
  const date = row[COL.date];
  return {
    id: String(row[COL.id]),
    timestamp: ts instanceof Date ? ts.toISOString() : String(ts || ''),
    date: date instanceof Date ? Utilities.formatDate(date, tz, 'yyyy-MM-dd') : String(date || ''),
    type: String(row[COL.type] || '').trim().toUpperCase(),
    category: String(row[COL.category] || ''),
    amount: Number(row[COL.amount]) || 0,
    created_by: String(row[COL.created_by] || ''),
    notes: String(row[COL.notes] || '')
  };
}

function toRow_(tx) {
  return HEADERS.map(function (h) { return safeCell_(tx[h]); });
}

/** Κείμενο που ξεκινά με =, +, - ή @ γράφεται ως απλό κείμενο και όχι ως τύπος. */
function safeCell_(v) {
  return typeof v === 'string' && /^[=+\-@]/.test(v) ? "'" + v : v;
}

// ---------------------------------------------------------------------------
// Validation, auth, plumbing

function cleanTx_(input) {
  if (!input || typeof input !== 'object') throw apiError_('invalid', 'Λείπουν τα στοιχεία της κίνησης');

  const type = String(input.type || '').toUpperCase();
  if (TYPES.indexOf(type) < 0) throw apiError_('invalid', 'Μη έγκυρο είδος κίνησης');

  const amount = Math.round(Number(input.amount) * 100) / 100;
  if (!isFinite(amount) || amount <= 0 || amount > 1000000) throw apiError_('invalid', 'Μη έγκυρο ποσό');

  const date = String(input.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw apiError_('invalid', 'Μη έγκυρη ημερομηνία');

  const category = text_(input.category, 60);
  if (!category) throw apiError_('invalid', 'Λείπει η κατηγορία');

  const createdBy = text_(input.created_by, 40);
  if (!createdBy) throw apiError_('invalid', 'Λείπει ο καταχωρητής');

  const id = input.id ? String(input.id) : Utilities.getUuid();
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(id)) throw apiError_('invalid', 'Μη έγκυρο id');

  return {
    id: id,
    date: date,
    type: type,
    category: category,
    amount: amount,
    created_by: createdBy,
    notes: text_(input.notes, 500)
  };
}

function text_(v, max) {
  return String(v == null ? '' : v).trim().slice(0, max);
}

function validTimestamp_(v) {
  const s = String(v || '');
  return /^\d{4}-\d{2}-\d{2}T/.test(s) && !isNaN(Date.parse(s)) ? s : null;
}

function checkPin_(pin) {
  const expected = PropertiesService.getScriptProperties().getProperty('PIN');
  if (!expected) throw apiError_('not_configured', 'Δεν έχει οριστεί PIN. Τρέξε πρώτα τη setup() στο Apps Script.');
  const cache = CacheService.getScriptCache();
  const fails = Number(cache.get('pin_fails') || 0);
  if (fails >= MAX_FAILED_PINS) {
    throw apiError_('locked', 'Πολλές λάθος προσπάθειες PIN. Δοκίμασε ξανά σε 10 λεπτά.');
  }
  if (String(pin || '') !== expected) {
    cache.put('pin_fails', String(fails + 1), LOCKOUT_SECONDS);
    throw apiError_('bad_pin', 'Λάθος PIN');
  }
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

function respond_(fn) {
  let out;
  try {
    out = Object.assign({ ok: true }, fn());
  } catch (err) {
    out = {
      ok: false,
      error: (err && err.code) || 'server_error',
      message: String((err && err.message) || err)
    };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function apiError_(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}
