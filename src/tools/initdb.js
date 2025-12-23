require('dotenv').config({ path: process.env.ENV_FILE || '.env' });
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const { openDb } = require('../db');

const DB_PATH = process.env.DB_PATH || './data/app.db';
const schemaPath = path.join(__dirname, '..', 'db', 'schema.sql');

const adminUser = process.env.DEFAULT_ADMIN_USER || 'admin';
const adminPass = process.env.DEFAULT_ADMIN_PASS || 'admin123!';

const db = openDb(DB_PATH);
const schema = fs.readFileSync(schemaPath, 'utf-8');
db.exec(schema);

const insertCourse = db.prepare('INSERT OR IGNORE INTO courses(name) VALUES (?)');
insertCourse.run('default');

const courseId = db.prepare('SELECT id FROM courses WHERE name=?').get('default').id;

const existing = db.prepare('SELECT id FROM users WHERE username=?').get(adminUser);
if (!existing) {
  const pw_hash = bcrypt.hashSync(adminPass, 12);
  db.prepare(`INSERT INTO users(username, display_name, role, course_id, pw_hash) VALUES (?,?,?,?,?)`)
    .run(adminUser, 'Administrator', 'admin', courseId, pw_hash);
  console.log(`Admin angelegt: ${adminUser} / ${adminPass}`);
} else {
  console.log(`Admin existiert bereits: ${adminUser}`);
}
console.log(`DB initialisiert unter: ${DB_PATH}`);
