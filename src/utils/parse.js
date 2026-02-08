function parseOptionalId(value) {
  const raw = (value || '').toString().trim();
  if (!raw) return null;
  const id = Number(raw);
  return Number.isFinite(id) ? id : null;
}

function parseIdList(raw) {
  return (raw || '')
    .toString()
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number)
    .filter(Number.isFinite);
}

module.exports = { parseOptionalId, parseIdList };
