# CLAUDE.md

Ταμείο Ιδιαίτερων: PWA για καταθέσεις και πληρωμές ιδιαίτερων μαθημάτων. Το backend είναι Google Apps Script πάνω σε Google Sheet. Το frontend είναι στατικά αρχεία (vanilla JS, χωρίς build). UI, σχόλια και commit messages γράφονται στα ελληνικά.

## Δομή

- `backend/Code.gs`: όλο το API. Τρέχει στο Apps Script του Google Sheet. Χρησιμοποιεί σύνταξη ES5-ish (`function`, `var`/`const`), όχι modules.
- `docs/`: το frontend, που σερβίρεται όπως είναι από GitHub Pages (`main` / `/docs`).
  - `app.js`: όλη η λογική σε ένα IIFE (state, outbox, sync, render).
  - `config.js`: `API_URL`, χρήστες, κατηγορίες, γρήγορα κουμπιά (`PRESETS`). Εδώ γίνονται οι συνηθισμένες αλλαγές, όπως νέο μάθημα ή άλλο ποσό.
  - `sw.js`: network-first με fallback στο cache μετά από 3″. Δεν χρειάζεται bump του `CACHE` σε κάθε αλλαγή.
- `dev/server.mjs`: τοπικός server. Φορτώνει τον **πραγματικό** `Code.gs` μέσω `vm`, με ψεύτικα `SpreadsheetApp`, `PropertiesService` κ.λπ., σε in-memory sheet.

## Εντολές

```bash
node dev/server.mjs                  # http://localhost:8787/#api=http://localhost:8787/api&pin=1234
PORT=8799 DELAY=0 node dev/server.mjs
node --check docs/app.js             # δεν υπάρχει build/lint/test suite
```

Αν το `Code.gs` χρησιμοποιήσει νέα υπηρεσία ή μέθοδο του Apps Script, πρόσθεσέ τη και στα fakes του `dev/server.mjs`.

## Deploy

- **Frontend:** `git push` στο `main`. Το GitHub Pages ξαναχτίζεται σε 1–2′ στο https://usr3-1415.github.io/idiaitera/. Το repo `usr3-1415/idiaitera` είναι **public**, γιατί στο δωρεάν πλάνο δεν γίνεται Pages σε private repo.
- **Backend:** δεν γίνεται deploy από εδώ. Ο χρήστης επικολλά τον `Code.gs` στον editor του Apps Script και κάνει **Deploy → Manage deployments → Edit → New version**, ώστε να μείνει ίδιο το URL. Αν κάνει «New deployment», αλλάζει το URL και πρέπει να ενημερωθεί το `config.js`.

## Κανόνες και παγίδες

- **Το PIN δεν μπαίνει ποτέ στο repo**, ούτε σε αρχεία, commits ή README. Το repo είναι δημόσιο. Το PIN ζει μόνο στα Script properties του Apps Script και στο localStorage των κινητών.
- **Μη γράφεις δοκιμαστικά δεδομένα στο πραγματικό Sheet** (το `API_URL` στο `config.js`). Δοκιμές γίνονται στο `dev/server.mjs`. Για έλεγχο του live API χωρίς παρενέργειες: GET `?action=list` ή `delete` με id που δεν υπάρχει (no-op).
- **Περιορισμοί του Apps Script:** δεν υπάρχουν paths, PUT ή DELETE, οπότε όλα πάνε στο ίδιο `/exec` με πεδίο `action`. Η απάντηση είναι πάντα HTTP 200 και τα σφάλματα έρχονται ως `{ok:false, error, message}`. Το POST στέλνεται **χωρίς** `Content-Type` header (άρα `text/plain`), γιατί αλλιώς ο browser κάνει CORS preflight που το Apps Script δεν υποστηρίζει.
- **Idempotency:** ο client δίνει το `id` (UUID). Το `create` με id που υπάρχει ήδη είναι no-op, όπως και το `delete` για id που λείπει. Η offline ουρά (`tameio.outbox` στο localStorage) βασίζεται σε αυτό για ασφαλή επανάληψη αποστολών. Μην το σπάσεις.
- **Τύποι στο Sheet:** οι στήλες A–E και G–H είναι text format (`@`) ώστε το Sheets να μη μετατρέπει ημερομηνίες και ids. Το `safeCell_` βάζει `'` μπροστά από κείμενο που ξεκινά με `= + - @`. Το `rowToTx_` χειρίζεται και `Date` αντικείμενα, για γραμμές που προστέθηκαν με το χέρι.
- **Ποσά:** τα σύνολα υπολογίζονται σε λεπτά (`Math.round(x*100)`). Ο client δέχεται ελληνική μορφή (`50,5`, `1.000`).
- **Mobile layout:** στόχος είναι πλάτος 320px χωρίς οριζόντια υπερχείλιση. Σε grid χρησιμοποίησε `minmax(0, 1fr)` και πρόσεχε το `white-space: nowrap`: μια υπερχείλιση φαρδαίνει το layout viewport και σπρώχνει το κάτω μενού έξω από την οθόνη. Έλεγχος: `document.documentElement.scrollWidth > innerWidth`.
- **UX:** τα γρήγορα κουμπιά πρέπει να φαίνονται καθαρά ως κουμπιά. Μια παλιότερη εκδοχή, «Κατάθεση +1.000 €» σε κάρτα, μπερδεύτηκε με κίνηση ή υπόλοιπο.

## UI έλεγχος με Playwright (WSL)

Δεν υπάρχει Playwright στο repo. Εγκαθίσταται σε προσωρινό φάκελο (`npm i playwright` + `npx playwright install chromium`). Σε αυτό το WSL το `browser.newContext()` με `locale`, `timezoneId` ή `colorScheme` κάνει το `newPage()` να κολλάει. Χρησιμοποίησε `devices['iPhone SE']`, `chromium.launch({ args: ['--no-sandbox'] })` και `page.emulateMedia({ colorScheme: 'dark' })` αφού ανοίξει η σελίδα. Το `pkill -f "dev/server.mjs"` σκοτώνει και το ίδιο το shell, γιατί το pattern ταιριάζει και στην εντολή. Χρησιμοποίησε `pgrep -f "[n]ode dev/server.mjs"`.
