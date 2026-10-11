// Ρυθμίσεις της εφαρμογής. Το μόνο που χρειάζεται οπωσδήποτε αλλαγή είναι το API_URL.
window.APP_CONFIG = {
  // Το URL του Apps Script Web App (Deploy → Web app → URL, τελειώνει σε /exec).
  // Μπορεί να μείνει κενό και να οριστεί από τις Ρυθμίσεις της εφαρμογής.
  API_URL: 'https://script.google.com/macros/s/AKfycbwx6pZwoqyrfxV0ArSWVZGDU7QWU4tl0aZT-K93WstWxCXDc-HWfQu6-3v-X7NIX-N1/exec',

  USERS: ['Μπαμπάς', 'Κυριάκος'],

  // Κατηγορίες για πληρωμές μαθημάτων (οι καταθέσεις έχουν πάντα κατηγορία "Κατάθεση").
  EXPENSE_CATEGORIES: ['Φυσική', 'Χημεία', 'Έκθεση', 'Άλλο'],

  // Γρήγορα κουμπιά. Το ποσό κάθε μαθήματος συμπληρώνεται και όταν το διαλέξεις από τη λίστα.
  PRESETS: [
    { type: 'DEPOSIT', category: 'Κατάθεση', amount: 1000 },
    { type: 'EXPENSE', category: 'Φυσική', amount: 50 },
    { type: 'EXPENSE', category: 'Χημεία', amount: 50 },
    { type: 'EXPENSE', category: 'Έκθεση', amount: 250 },
  ],
};
