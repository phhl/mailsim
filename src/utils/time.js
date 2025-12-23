// Time helpers
// DB timestamps are stored in UTC (SQLite datetime('now') or ISO strings).
// The UI should display Berlin time for consistency in German school context.

function toBerlinLocal(ts) {
  if (!ts) return '';
  try {
    const s = String(ts);
    // Handle both "YYYY-MM-DD HH:MM:SS" and ISO strings.
    const iso = s.includes('T')
      ? (s.endsWith('Z') ? s : s + 'Z')
      : s.replace(' ', 'T') + 'Z';

    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return s;

    return d.toLocaleString('de-DE', {
      timeZone: 'Europe/Berlin',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return String(ts);
  }
}

module.exports = { toBerlinLocal };
