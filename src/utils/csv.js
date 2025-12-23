// CSV helper: we intentionally emit *unquoted* CSV to match the import format.
// To keep the file reasonably robust without quotes, we strip commas and newlines.

function csvFieldNoQuotes(v) {
  return String(v ?? '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/,/g, ' ')
    .trim();
}

module.exports = { csvFieldNoQuotes };
