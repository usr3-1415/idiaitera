'use strict';

(() => {
  const CFG = window.APP_CONFIG || {};
  const USERS = CFG.USERS || ['Μπαμπάς', 'Κυριάκος'];
  const EXPENSE_CATEGORIES = CFG.EXPENSE_CATEGORIES || ['Άλλο'];
  const PRESETS = CFG.PRESETS || [];
  const DEPOSIT_CATEGORY = 'Κατάθεση';
  const AUTH_ERRORS = ['bad_pin', 'locked', 'not_configured'];
  const LS = { settings: 'tameio.settings', cache: 'tameio.cache', outbox: 'tameio.outbox' };

  // ---------------------------------------------------------------------------
  // Storage & state

  const load = (key, fallback) => {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
  };
  const store = (key, value) => {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode: μένει στη μνήμη */ }
  };

  const cache = load(LS.cache, {});
  const state = {
    settings: load(LS.settings, {}),
    txs: cache.transactions || [],   // τελευταία εικόνα του server
    fetchedAt: cache.fetchedAt || null,
    outbox: load(LS.outbox, []),      // αλλαγές που δεν έχουν φτάσει ακόμα στον server
    syncing: false,
    lastError: null,
    tab: 'entry',
    editingId: null,
  };

  // Ρύθμιση με link: index.html#api=<url>&pin=<pin>&me=<όνομα>
  function importSettingsFromHash() {
    const params = new URLSearchParams(location.hash.slice(1));
    if (!params.has('api') && !params.has('pin') && !params.has('me')) return false;
    for (const [param, key] of [['api', 'apiUrl'], ['pin', 'pin'], ['me', 'me']]) {
      if (params.get(param)) state.settings[key] = params.get(param);
    }
    store(LS.settings, state.settings);
    history.replaceState(null, '', location.pathname + location.search);
    return true;
  }
  importSettingsFromHash();
  // Αν το link ανοίξει ενώ η εφαρμογή είναι ήδη φορτωμένη, ξεκινάμε από την αρχή με τις νέες ρυθμίσεις.
  window.addEventListener('hashchange', () => { if (importSettingsFromHash()) location.reload(); });

  const apiUrl = () => (state.settings.apiUrl || CFG.API_URL || '').trim();
  const configured = () => Boolean(apiUrl() && state.settings.pin && state.settings.me);

  // ---------------------------------------------------------------------------
  // Formatting helpers

  const $ = (sel) => document.querySelector(sel);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const money = (n) => new Intl.NumberFormat('el-GR', {
    style: 'currency', currency: 'EUR',
    minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2,
  }).format(n);
  const signed = (tx) => (tx.type === 'DEPOSIT' ? '+' : '−') + money(tx.amount);

  const parseDate = (ymd) => { const [y, m, d] = ymd.split('-').map(Number); return new Date(y, m - 1, d); };
  // Γραμμές που γράφτηκαν με το χέρι στο Sheet μπορεί να έχουν λάθος ημερομηνία: τη δείχνουμε όπως είναι.
  const fmtDate = (ymd, opts) => { const d = parseDate(ymd); return isNaN(d) ? ymd : new Intl.DateTimeFormat('el-GR', opts).format(d); };
  const fmtDay = (ymd) => fmtDate(ymd, { weekday: 'short', day: 'numeric', month: 'short' });
  const fmtMonth = (ym) => fmtDate(ym + '-01', { month: 'long', year: 'numeric' });
  const today = () => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };

  const fmtSynced = (ms) => {
    const d = new Date(ms);
    const time = d.toLocaleTimeString('el-GR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    return d.toDateString() === new Date().toDateString() ? time : `${d.toLocaleDateString('el-GR')} ${time}`;
  };

  /** Δέχεται "50", "50,5", "1.000", "1.000,50", "12.5". */
  const parseAmount = (raw) => {
    let s = String(raw).replace(/[\s€]/g, '');
    if (!s) return NaN;
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
    return Math.round(Number(s) * 100) / 100;
  };
  const amountInput = (n) => String(n).replace('.', ',');

  const uuid = () => crypto.randomUUID?.() ??
    Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');

  const defaultAmount = (type, category) =>
    PRESETS.find((p) => p.type === type && (type === 'DEPOSIT' || p.category === category))?.amount;

  // ---------------------------------------------------------------------------
  // Data: server snapshot + τοπικές αλλαγές σε αναμονή

  function viewTxs() {
    let list = state.txs.slice();
    for (const op of state.outbox) {
      if (op.op === 'create') {
        if (!list.some((t) => t.id === op.tx.id)) list.push({ ...op.tx, _pending: true });
      } else if (op.op === 'update') {
        list = list.map((t) => (t.id === op.tx.id ? { ...op.tx, _pending: true } : t));
      } else if (op.op === 'delete') {
        list = list.filter((t) => t.id !== op.id);
      }
    }
    return list.sort((a, b) => b.date.localeCompare(a.date) || b.timestamp.localeCompare(a.timestamp));
  }

  const balanceOf = (txs) =>
    txs.reduce((cents, t) => cents + (t.type === 'DEPOSIT' ? 1 : -1) * Math.round(t.amount * 100), 0) / 100;

  const findTx = (id) => viewTxs().find((t) => t.id === id);
  const plain = ({ _pending, ...tx }) => tx;

  function applySnapshot(data) {
    state.txs = data.transactions || [];
    state.fetchedAt = Date.now();
    store(LS.cache, { transactions: state.txs, fetchedAt: state.fetchedAt });
  }

  // ---------------------------------------------------------------------------
  // API

  async function api(method, payload, conn = { apiUrl: apiUrl(), pin: state.settings.pin }) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 25000);
    let res;
    try {
      res = method === 'GET'
        ? await fetch(`${conn.apiUrl}?action=list&pin=${encodeURIComponent(conn.pin)}`, { signal: ctrl.signal, cache: 'no-store' })
        // Χωρίς Content-Type header → text/plain, ώστε να μη γίνεται CORS preflight (το Apps Script δεν το υποστηρίζει).
        : await fetch(conn.apiUrl, { method: 'POST', body: JSON.stringify({ ...payload, pin: conn.pin }), signal: ctrl.signal });
    } catch {
      throw apiError('network', 'Χωρίς σύνδεση');
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) throw apiError('network', `Σφάλμα δικτύου (HTTP ${res.status})`);
    let data;
    try { data = await res.json(); } catch { throw apiError('network', 'Μη αναμενόμενη απάντηση από τον server'); }
    if (!data.ok) throw apiError(data.error || 'server_error', data.message || 'Σφάλμα server');
    return data;
  }

  const apiError = (code, message) => Object.assign(new Error(message), { code });

  function enqueue(op) {
    state.outbox.push({ ...op, attempts: 0 });
    store(LS.outbox, state.outbox);
    render();
    sync({ pull: false });
  }

  async function sync({ pull = true } = {}) {
    if (state.syncing || !configured()) return;
    state.syncing = true;
    state.lastError = null;
    renderStatus();
    try {
      while (state.outbox.length) {
        const op = state.outbox[0];
        try {
          const payload = op.op === 'delete' ? { action: 'delete', id: op.id } : { action: op.op, tx: op.tx };
          applySnapshot(await api('POST', payload));
          pull = false;
        } catch (err) {
          const retryable = err.code === 'network' || (err.code === 'server_error' && ++op.attempts < 5);
          if (retryable || AUTH_ERRORS.includes(err.code)) {
            store(LS.outbox, state.outbox);
            throw err;
          }
          // Μόνιμο σφάλμα (π.χ. μη έγκυρα στοιχεία): η αλλαγή απορρίπτεται.
          toast(`Δεν αποθηκεύτηκε: ${err.message}`);
        }
        state.outbox.splice(state.outbox.indexOf(op), 1);
        store(LS.outbox, state.outbox);
        render();
      }
      if (pull) applySnapshot(await api('GET'));
    } catch (err) {
      state.lastError = err;
      if (err.code === 'bad_pin') openSettings('Λάθος PIN. Έλεγξέ το και ξαναδοκίμασε.');
    } finally {
      state.syncing = false;
      render();
    }
    // Αλλαγές που μπήκαν στην ουρά όσο τρέχαμε το τελικό GET.
    if (state.outbox.length && !state.lastError) sync({ pull: false });
  }

  // ---------------------------------------------------------------------------
  // DOM

  const els = {
    balance: $('#balance'), syncStatus: $('#sync-status'), refreshBtn: $('#refresh-btn'), settingsBtn: $('#settings-btn'),
    viewEntry: $('#view-entry'), viewHistory: $('#view-history'), tabs: document.querySelectorAll('.tabbar button'),
    presets: $('#presets'), form: $('#entry-form'), editBanner: $('#edit-banner'), cancelEdit: $('#cancel-edit'),
    typeSeg: $('#type-seg'), category: $('#category'), categoryField: $('#category-field'),
    amount: $('#amount'), date: $('#date'), bySeg: $('#by-seg'), notes: $('#notes'),
    formError: $('#form-error'), submitBtn: $('#submit-btn'), deleteBtn: $('#delete-btn'),
    filterMonth: $('#filter-month'), filterCategory: $('#filter-category'), summary: $('#summary'),
    txList: $('#tx-list'), empty: $('#empty'),
    settingsDialog: $('#settings-dialog'), settingsForm: $('#settings-form'), meSeg: $('#me-seg'), pin: $('#pin'),
    apiUrl: $('#api-url'), apiDetails: $('#api-details'), settingsError: $('#settings-error'),
    settingsSave: $('#settings-save'), settingsCancel: $('#settings-cancel'),
    toast: $('#toast'), toastText: $('#toast-text'), toastAction: $('#toast-action'),
  };

  const userButtons = USERS.map((u) => `<button type="button" role="radio" data-value="${esc(u)}">${esc(u)}</button>`).join('');
  els.bySeg.innerHTML = userButtons;
  els.meSeg.innerHTML = userButtons;

  const getSeg = (seg) => seg.querySelector('[aria-checked="true"]')?.dataset.value || '';
  const setSeg = (seg, value) => seg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.value === value)));
  const showError = (el, msg) => { el.textContent = msg || ''; el.hidden = !msg; };

  let toastTimer;
  function toast(text, actionLabel, action) {
    els.toastText.textContent = text;
    els.toastAction.hidden = !actionLabel;
    els.toastAction.textContent = actionLabel || '';
    els.toastAction.onclick = action ? () => { els.toast.hidden = true; action(); } : null;
    els.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { els.toast.hidden = true; }, actionLabel ? 6000 : 3000);
  }

  // ---------------------------------------------------------------------------
  // Header

  function renderStatus() {
    const pending = state.outbox.length;
    let text = '';
    if (!configured()) text = 'Δεν έχει ρυθμιστεί η σύνδεση';
    else if (state.syncing) text = 'Συγχρονισμός…';
    else if (state.lastError) text = state.lastError.message;
    else if (state.fetchedAt) text = `Ενημερώθηκε ${fmtSynced(state.fetchedAt)}`;
    if (pending) text += `${text ? ' · ' : ''}${pending} σε αναμονή`;
    els.syncStatus.textContent = text;
    els.refreshBtn.classList.toggle('spinning', state.syncing);
  }

  function render() {
    const txs = viewTxs();
    const balance = balanceOf(txs);
    els.balance.textContent = state.fetchedAt || txs.length ? money(balance) : '—';
    els.balance.classList.toggle('negative', balance < 0);
    renderStatus();
    renderHistory(txs);
  }

  // ---------------------------------------------------------------------------
  // Νέα κίνηση

  els.presets.innerHTML = PRESETS.map((p, i) => `
    <button type="button" class="preset ${p.type === 'DEPOSIT' ? 'deposit' : 'expense'}" data-preset="${i}">
      <span class="p-cat">${esc(p.label || p.category)}</span>
      <span class="p-amt">${p.type === 'DEPOSIT' ? '+' : '−'}${esc(money(p.amount))}</span>
    </button>`).join('') + `
    <button type="button" class="preset custom" data-preset="custom">
      <span class="p-cat">Άλλο ποσό</span><span class="p-amt">Custom</span>
    </button>`;

  function renderCategoryOptions(type, selected) {
    const options = type === 'DEPOSIT' ? [DEPOSIT_CATEGORY] : EXPENSE_CATEGORIES.slice();
    if (selected && !options.includes(selected)) options.push(selected);
    els.category.innerHTML = options.map((c) => `<option>${esc(c)}</option>`).join('');
    els.category.value = selected && options.includes(selected) ? selected : options[0];
    els.categoryField.hidden = options.length === 1;
  }

  function setForm({ type = 'EXPENSE', category, amount, date = today(), created_by = state.settings.me, notes = '' }) {
    setSeg(els.typeSeg, type);
    renderCategoryOptions(type, category);
    els.amount.value = amount != null ? amountInput(amount) : '';
    els.date.value = date;
    setSeg(els.bySeg, created_by || '');
    els.notes.value = notes;
    showError(els.formError, '');
    highlightPreset();
  }

  function readForm() {
    return {
      type: getSeg(els.typeSeg),
      category: els.category.value,
      amount: parseAmount(els.amount.value),
      date: els.date.value,
      created_by: getSeg(els.bySeg),
      notes: els.notes.value.trim(),
    };
  }

  function highlightPreset() {
    const f = readForm();
    els.presets.querySelectorAll('[data-preset]').forEach((b) => {
      const p = PRESETS[b.dataset.preset];
      b.classList.toggle('selected', Boolean(p) && p.type === f.type && p.category === f.category && p.amount === f.amount);
    });
  }

  // Όταν αλλάζει είδος/μάθημα, βάζουμε το προεπιλεγμένο ποσό, εκτός αν ο χρήστης έχει γράψει δικό του.
  function refreshDefaultAmount(prevType, prevCategory) {
    const current = parseAmount(els.amount.value);
    if (els.amount.value.trim() && current !== defaultAmount(prevType, prevCategory)) return;
    const next = defaultAmount(getSeg(els.typeSeg), els.category.value);
    els.amount.value = next != null ? amountInput(next) : '';
  }

  els.presets.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-preset]');
    if (!btn) return;
    const keep = { date: els.date.value || today(), created_by: getSeg(els.bySeg) || state.settings.me };
    if (btn.dataset.preset === 'custom') {
      setForm({ ...keep, type: 'EXPENSE', category: 'Άλλο' });
      els.amount.focus();
      return;
    }
    const p = PRESETS[btn.dataset.preset];
    setForm({ ...keep, type: p.type, category: p.category, amount: p.amount });
    els.submitBtn.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    els.submitBtn.classList.remove('flash');
    void els.submitBtn.offsetWidth;
    els.submitBtn.classList.add('flash');
  });

  els.typeSeg.addEventListener('click', (e) => {
    const value = e.target.closest('button')?.dataset.value;
    if (!value || value === getSeg(els.typeSeg)) return;
    const prev = [getSeg(els.typeSeg), els.category.value];
    setSeg(els.typeSeg, value);
    renderCategoryOptions(value);
    refreshDefaultAmount(...prev);
    highlightPreset();
  });

  let prevCategory = null;
  els.category.addEventListener('focus', () => { prevCategory = els.category.value; });
  els.category.addEventListener('change', () => {
    refreshDefaultAmount(getSeg(els.typeSeg), prevCategory);
    prevCategory = els.category.value;
    highlightPreset();
  });

  for (const seg of [els.bySeg, els.meSeg]) {
    seg.addEventListener('click', (e) => {
      const value = e.target.closest('button')?.dataset.value;
      if (value) setSeg(seg, value);
    });
  }
  els.amount.addEventListener('input', highlightPreset);

  els.form.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = readForm();
    if (!(f.amount > 0)) return formError('Συμπλήρωσε σωστό ποσό.', els.amount);
    if (!f.date) return formError('Διάλεξε ημερομηνία.', els.date);
    if (!f.created_by) return formError('Διάλεξε ποιος καταχωρεί.');
    showError(els.formError, '');
    els.amount.blur();
    els.notes.blur();

    if (state.editingId) {
      const original = findTx(state.editingId);
      if (!original) { exitEdit(); return toast('Η κίνηση δεν υπάρχει πια.'); }
      enqueue({ op: 'update', tx: { ...plain(original), ...f } });
      exitEdit();
      switchTab('history');
      toast('Οι αλλαγές αποθηκεύτηκαν');
      return;
    }

    const tx = { id: uuid(), timestamp: new Date().toISOString(), ...f };
    enqueue({ op: 'create', tx });
    setForm({ type: f.type, category: f.category, date: f.date, created_by: f.created_by });
    refreshDefaultAmount(f.type, f.category);
    highlightPreset();
    toast(`${tx.category} ${signed(tx)} καταχωρήθηκε`, 'Αναίρεση', () => enqueue({ op: 'delete', id: tx.id }));
  });

  function formError(msg, focusEl) {
    showError(els.formError, msg);
    focusEl?.focus();
  }

  // ---------------------------------------------------------------------------
  // Επεξεργασία / διαγραφή

  function startEdit(id) {
    const tx = findTx(id);
    if (!tx) return;
    state.editingId = id;
    setForm(tx);
    els.editBanner.hidden = false;
    els.deleteBtn.hidden = false;
    els.presets.hidden = true;
    els.submitBtn.textContent = 'Αποθήκευση αλλαγών';
    switchTab('entry');
  }

  function exitEdit() {
    state.editingId = null;
    els.editBanner.hidden = true;
    els.deleteBtn.hidden = true;
    els.presets.hidden = false;
    els.submitBtn.textContent = 'Καταχώρηση';
    setForm({ type: 'EXPENSE' });
    refreshDefaultAmount();
  }

  els.cancelEdit.addEventListener('click', () => { exitEdit(); switchTab('history'); });

  els.deleteBtn.addEventListener('click', () => {
    const tx = findTx(state.editingId);
    if (!tx) return exitEdit();
    if (!confirm(`Διαγραφή της κίνησης «${tx.category} ${signed(tx)}» (${fmtDay(tx.date)});`)) return;
    const original = plain(tx);
    enqueue({ op: 'delete', id: tx.id });
    exitEdit();
    switchTab('history');
    toast('Η κίνηση διαγράφηκε', 'Αναίρεση', () => enqueue({ op: 'create', tx: original }));
  });

  // ---------------------------------------------------------------------------
  // Ιστορικό

  function fillSelect(select, options, allLabel) {
    const current = select.value;
    select.innerHTML = `<option value="">${esc(allLabel)}</option>` +
      options.map(([value, label]) => `<option value="${esc(value)}">${esc(label)}</option>`).join('');
    select.value = options.some(([v]) => v === current) ? current : '';
  }

  function renderHistory(txs) {
    const months = [...new Set(txs.map((t) => t.date.slice(0, 7)))].sort().reverse();
    fillSelect(els.filterMonth, months.map((m) => [m, fmtMonth(m)]), 'Όλοι οι μήνες');
    const categories = [...new Set([DEPOSIT_CATEGORY, ...EXPENSE_CATEGORIES, ...txs.map((t) => t.category)])];
    fillSelect(els.filterCategory, categories.map((c) => [c, c]), 'Όλα τα είδη');

    const month = els.filterMonth.value;
    const category = els.filterCategory.value;
    const shown = txs.filter((t) => (!month || t.date.startsWith(month)) && (!category || t.category === category));

    const sum = (type) => shown.filter((t) => t.type === type).reduce((s, t) => s + Math.round(t.amount * 100), 0) / 100;
    const deposits = sum('DEPOSIT');
    const expenses = sum('EXPENSE');
    const parts = [`${shown.length} ${shown.length === 1 ? 'κίνηση' : 'κινήσεις'}`];
    if (deposits) parts.push(`Καταθέσεις <span class="plus">+${esc(money(deposits))}</span>`);
    if (expenses) parts.push(`Πληρωμές <span class="minus">−${esc(money(expenses))}</span>`);
    els.summary.innerHTML = parts.map((p) => `<span>${p}</span>`).join('');

    els.txList.innerHTML = shown.map((t) => `
      <li><button type="button" class="tx${t._pending ? ' pending' : ''}" data-id="${esc(t.id)}">
        <span class="tx-main">
          <span class="tx-title">${esc(t.category)}${t.notes ? ` <span class="tx-notes">· ${esc(t.notes)}</span>` : ''}</span>
          <span class="tx-meta">${esc(fmtDay(t.date))} · ${esc(t.created_by)}${t._pending ? '<span class="badge">σε αναμονή</span>' : ''}</span>
        </span>
        <span class="tx-amt ${t.type === 'DEPOSIT' ? 'plus' : 'minus'}">${esc(signed(t))}</span>
      </button></li>`).join('');
    els.empty.hidden = shown.length > 0;
  }

  els.filterMonth.addEventListener('change', render);
  els.filterCategory.addEventListener('change', render);
  els.txList.addEventListener('click', (e) => {
    const row = e.target.closest('[data-id]');
    if (row) startEdit(row.dataset.id);
  });

  // ---------------------------------------------------------------------------
  // Tabs

  function switchTab(tab) {
    if (tab === 'history' && state.editingId) exitEdit();
    state.tab = tab;
    els.viewEntry.hidden = tab !== 'entry';
    els.viewHistory.hidden = tab !== 'history';
    els.tabs.forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    window.scrollTo(0, 0);
  }
  els.tabs.forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));

  // ---------------------------------------------------------------------------
  // Ρυθμίσεις

  function openSettings(message) {
    setSeg(els.meSeg, state.settings.me || '');
    els.pin.value = state.settings.pin || '';
    els.apiUrl.value = apiUrl();
    els.apiDetails.open = !apiUrl();
    els.settingsCancel.hidden = !configured();
    showError(els.settingsError, message);
    if (!els.settingsDialog.open) els.settingsDialog.showModal();
  }

  els.settingsBtn.addEventListener('click', () => openSettings());
  els.settingsCancel.addEventListener('click', () => els.settingsDialog.close());
  els.settingsDialog.addEventListener('cancel', (e) => { if (!configured()) e.preventDefault(); });

  els.settingsForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const next = { me: getSeg(els.meSeg), pin: els.pin.value.trim(), apiUrl: els.apiUrl.value.trim() };
    if (!next.me) return showError(els.settingsError, 'Διάλεξε ποιος είσαι.');
    if (!next.pin) return showError(els.settingsError, 'Συμπλήρωσε το PIN.');
    if (!/^https?:\/\//.test(next.apiUrl)) {
      els.apiDetails.open = true;
      return showError(els.settingsError, 'Συμπλήρωσε το URL του Apps Script.');
    }

    els.settingsSave.disabled = true;
    els.settingsSave.textContent = 'Έλεγχος…';
    try {
      applySnapshot(await api('GET', null, next));
    } catch (err) {
      // Χωρίς internet κρατάμε τις ρυθμίσεις και ελέγχουμε στον επόμενο συγχρονισμό.
      if (err.code !== 'network' || navigator.onLine) {
        return showError(els.settingsError, err.code === 'network'
          ? 'Δεν ήταν δυνατή η σύνδεση. Έλεγξε το URL και ότι το deployment έχει πρόσβαση «Anyone».'
          : err.message);
      }
    } finally {
      els.settingsSave.disabled = false;
      els.settingsSave.textContent = 'Αποθήκευση';
    }

    const firstRun = !state.settings.me;
    state.settings = { ...next, apiUrl: next.apiUrl === (CFG.API_URL || '').trim() ? '' : next.apiUrl };
    store(LS.settings, state.settings);
    els.settingsDialog.close();
    if (firstRun && !state.editingId) setSeg(els.bySeg, next.me);
    state.lastError = null;
    render();
    sync({ pull: false });
  });

  // ---------------------------------------------------------------------------
  // Εκκίνηση

  els.refreshBtn.addEventListener('click', () => sync());
  window.addEventListener('online', () => sync());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') sync(); });
  setInterval(() => {
    if (document.visibilityState !== 'visible') return;
    if (state.outbox.length || Date.now() - (state.fetchedAt || 0) > 120000) sync();
  }, 30000);

  setForm({ type: 'EXPENSE' });
  refreshDefaultAmount();
  render();
  if (configured()) sync();
  else openSettings();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* χωρίς offline cache */ });
  }
})();
