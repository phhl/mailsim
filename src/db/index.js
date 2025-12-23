const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

function openDb(dbPath) {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');
  return db;
}

module.exports = { openDb };
