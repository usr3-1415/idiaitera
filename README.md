# Ταμείο Ιδιαίτερων

Mobile web app (PWA) για το ταμείο των ιδιαίτερων μαθημάτων. Ο μπαμπάς καταχωρεί καταθέσεις, ο Κυριάκος πληρωμές μαθημάτων, και οι δύο βλέπουν το ίδιο υπόλοιπο. Τα δεδομένα αποθηκεύονται σε ένα Google Sheet.

- **Νέα κίνηση:** γρήγορα κουμπιά (Κατάθεση 1.000 €, Φυσική 50 €, Χημεία 50 €, Έκθεση 250 €, Άλλο ποσό) που συμπληρώνουν τη φόρμα. Μετά πατάς «Καταχώρηση».
- **Ιστορικό:** οι κινήσεις, οι νεότερες πρώτα, με φίλτρο ανά μήνα και κατηγορία και σύνολα για το φίλτρο. Πάτα μια κίνηση για να τη διορθώσεις ή να τη διαγράψεις.
- Το υπόλοιπο ενημερώνεται αμέσως μόλις πατήσεις «Καταχώρηση», πριν απαντήσει ο server. Κάθε καταχώρηση και διαγραφή έχει «Αναίρεση».
- **Δουλεύει και χωρίς σύνδεση.** Οι κινήσεις μένουν «σε αναμονή» και στέλνονται μόλις επανέλθει το internet.

```
backend/Code.gs           Google Apps Script (API πάνω στο Google Sheet)
backend/appsscript.json   manifest του Apps Script (προαιρετικό)
docs/                     το frontend (στατικά αρχεία, χωρίς build)
  config.js               URL του API, χρήστες, κατηγορίες, γρήγορα κουμπιά
dev/server.mjs            τοπικός server για δοκιμές χωρίς Google
```

---

## Setup

Χρειάζονται περίπου 15 λεπτά και ένας λογαριασμός Google. Το Sheet και το script θα ανήκουν σε αυτόν τον λογαριασμό.

### 1. Google Sheet και Apps Script

1. Φτιάξε ένα νέο Google Sheet (π.χ. «Ταμείο Ιδιαίτερων»).
2. Από το μενού: **Extensions → Apps Script**.
3. Σβήσε ό,τι υπάρχει στο `Code.gs` και επικόλλησε όλο το περιεχόμενο του [`backend/Code.gs`](backend/Code.gs). Πάτα 💾 Save.
4. Στη λίστα συναρτήσεων πάνω από τον κώδικα διάλεξε **`setup`** και πάτα **Run**.
   - Την πρώτη φορά θα ζητήσει άδεια: **Review permissions** → διάλεξε τον λογαριασμό σου → αν βγει «Google hasn't verified this app», πάτα **Advanced → Go to … (unsafe)** → **Allow**. Είναι το δικό σου script και έχει πρόσβαση μόνο σε αυτό το Sheet.
5. Στο **Execution log** θα δεις `Έτοιμο. PIN: 123456`. **Σημείωσε το PIN.**
   - Για να το αλλάξεις: ⚙️ **Project Settings → Script properties → PIN → Edit**.
6. Στο Sheet θα έχει εμφανιστεί το φύλλο **Transactions** με τις στήλες `id, timestamp, date, type, category, amount, created_by, notes`.

### 2. Δημοσίευση ως Web App

1. Στον editor του Apps Script: **Deploy → New deployment**.
2. ⚙️ δίπλα στο «Select type» → **Web app**.
3. Ρύθμισε:
   - **Execute as:** *Me*
   - **Who has access:** ***Anyone*** (όχι «Anyone with Google account», αλλιώς η εφαρμογή δεν μπορεί να συνδεθεί)
4. **Deploy** → αντέγραψε το **Web app URL** (τελειώνει σε `/exec`).

Για να ελέγξεις ότι δουλεύει, άνοιξε στον browser: `<URL>?action=list&pin=<PIN>`. Πρέπει να δεις `{"ok":true,"transactions":[],"balance":0}`.

> **Αν αλλάξεις τον κώδικα αργότερα:** **Deploy → Manage deployments → ✏️ Edit → Version: New version → Deploy**. Έτσι το URL μένει ίδιο. Αν κάνεις «New deployment», θα πάρεις καινούργιο URL.

### 3. Το frontend online (GitHub Pages)

1. Στο [`docs/config.js`](docs/config.js) βάλε το URL στο `API_URL`:
   ```js
   API_URL: 'https://script.google.com/macros/s/AKfy…/exec',
   ```
   (Μπορείς και να το αφήσεις κενό και να το δώσεις από τις Ρυθμίσεις της εφαρμογής ή με το link του βήματος 4.)
2. Ανέβασε το repo στο GitHub.
3. Στο repo: **Settings → Pages → Build and deployment → Source: Deploy from a branch → Branch: `main`, folder: `/docs` → Save**.
4. Σε 1–2 λεπτά η εφαρμογή θα είναι στο `https://<username>.github.io/<repo>/`.

Εναλλακτικά: σύρε τον φάκελο `docs/` στο [Netlify Drop](https://app.netlify.com/drop), ή κάνε deploy στο Vercel/Cloudflare Pages με output directory το `docs`. Αρκεί η εφαρμογή να σερβίρεται μέσω **https**, αλλιώς δεν εγκαθίσταται ως PWA.

### 4. Εγκατάσταση στα κινητά

Στείλε σε κάθε κινητό ένα link ρύθμισης, π.χ. στο Viber:

```
https://<username>.github.io/<repo>/#pin=123456
```

Αν **δεν** έβαλες το `API_URL` στο `config.js`, πρόσθεσε και `&api=<Web app URL>`. Μπορείς να προσθέσεις και `&me=Κυριάκος` για να οριστεί αυτόματα ο χρήστης. Η εφαρμογή αποθηκεύει τις ρυθμίσεις και σβήνει αμέσως το PIN από τη γραμμή διευθύνσεων. Την πρώτη φορά ρωτάει «Ποιος είσαι;» (Μπαμπάς / Κυριάκος), και αυτή η επιλογή γίνεται ο προεπιλεγμένος καταχωρητής σε εκείνο το κινητό.

Μετά, βάλ' τη στην αρχική οθόνη:

- **iPhone (Safari):** κουμπί Κοινοποίηση ⬆️ → **Προσθήκη στην οθόνη Αφετηρίας**.
- **Android (Chrome):** μενού ⋮ → **Εγκατάσταση εφαρμογής** (ή «Προσθήκη στην αρχική οθόνη»).

Ανοίγει σε πλήρη οθόνη σαν κανονική εφαρμογή, με το εικονίδιο «€».

> Στο iPhone, η εφαρμογή στην αρχική οθόνη έχει δικό της χώρο αποθήκευσης, ξεχωριστό από το Safari. Αν άνοιξες το link στο Safari και μετά την πρόσθεσες, μπορεί να ζητήσει ξανά PIN μία φορά.

---

## API

Το Apps Script δεν υποστηρίζει paths (`/api/transactions`) ούτε μεθόδους PUT/DELETE, γι' αυτό η ενέργεια δηλώνεται με το πεδίο `action`. Όλες οι απαντήσεις είναι JSON με HTTP 200: `{ "ok": true, … }` ή `{ "ok": false, "error": "<code>", "message": "…" }`.

| Αντί για | Κλήση | Απάντηση |
|---|---|---|
| `GET /api/transactions` | `GET <URL>?action=list&pin=…` | `{ ok, transactions[], balance }` |
| `POST /api/transactions` | `POST <URL>` με body `{"pin","action":"create","tx":{…}}` | `{ ok, transaction, transactions[], balance }` |
| `PUT /api/transactions/:id` | `POST <URL>` με body `{"pin","action":"update","tx":{"id",…}}` | ίδια |
| `DELETE /api/transactions/:id` | `POST <URL>` με body `{"pin","action":"delete","id":"…"}` | `{ ok, transactions[], balance }` |

`tx` = `{ id?, date: "YYYY-MM-DD", type: "DEPOSIT"|"EXPENSE", category, amount, created_by, notes? }`.
`balance = SUM(DEPOSIT) − SUM(EXPENSE)`, υπολογισμένο σε λεπτά για να μην υπάρχουν σφάλματα στρογγυλοποίησης.

- Το `id` το δημιουργεί ο client (UUID), οπότε αν μια αποστολή ξαναγίνει (π.χ. μετά από διακοπή σύνδεσης), δεν γράφεται διπλή εγγραφή. Το `delete` για id που δεν υπάρχει πετυχαίνει χωρίς να κάνει τίποτα.
- Το POST στέλνεται ως `text/plain`, ώστε ο browser να μην κάνει CORS preflight (το Apps Script δεν το υποστηρίζει).
- Κωδικοί σφάλματος: `bad_pin`, `locked` (10 λάθος PIN μέσα σε 10′), `not_configured`, `invalid`, `not_found`, `bad_action`, `bad_json`, `server_error`.

## Τοπική δοκιμή

Δεν χρειάζεσαι λογαριασμό Google. Χρειάζεσαι μόνο Node.js 18 ή νεότερο:

```bash
node dev/server.mjs
```

Άνοιξε το link που τυπώνει (`http://localhost:8787/#api=…&pin=1234`). Ο server τρέχει τον πραγματικό `backend/Code.gs` πάνω σε ένα ψεύτικο Sheet στη μνήμη, οπότε τα δεδομένα χάνονται όταν τον σταματήσεις. Επιλογές: `PIN=…`, `PORT=…`, `DELAY=<ms>` (τεχνητή καθυστέρηση δικτύου).

## Προσαρμογή

Στο [`docs/config.js`](docs/config.js) αλλάζεις χρήστες, κατηγορίες μαθημάτων και γρήγορα κουμπιά (ποσά). Όταν διαλέγεις μάθημα στη φόρμα, το ποσό συμπληρώνεται από το αντίστοιχο γρήγορο κουμπί.

## Σημειώσεις

- **Ασφάλεια:** όποιος έχει το URL του Web App **και** το PIN μπορεί να διαβάσει και να γράψει κινήσεις. Για ένα οικογενειακό ταμείο αρκεί. Μην μοιράζεσαι το PIN δημόσια και προτίμησε 6ψήφιο. Το URL του API στο `config.js` είναι δημόσιο αν το repo είναι public, αλλά χωρίς το PIN δεν χρησιμεύει σε τίποτα. Μετά από 10 λάθος PIN το API κλειδώνει για 10 λεπτά για όλους.
- **Χειροκίνητες αλλαγές στο Sheet επιτρέπονται.** Μπορείς να διορθώσεις ή να προσθέσεις γραμμές με το χέρι. Γραμμές χωρίς `id` παίρνουν αυτόματα id στην επόμενη ανάγνωση. Το `type` πρέπει να είναι `DEPOSIT` ή `EXPENSE` και η ημερομηνία `YYYY-MM-DD`.
- Η εφαρμογή ανανεώνει τα δεδομένα όταν ανοίγει, όταν επιστρέφεις σε αυτή και κάθε 2 λεπτά όσο είναι ανοιχτή. Το ⟳ πάνω δεξιά κάνει ανανέωση αμέσως.
- Οι διαγραφές σβήνουν τη γραμμή από το Sheet. Για πλήρες ιστορικό αλλαγών, δες το **File → Version history** του Google Sheet.
