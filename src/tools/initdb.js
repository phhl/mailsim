require('dotenv').config({ path: process.env.ENV_FILE || '.env' });
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { openDb } = require('../db');

const DB_PATH = process.env.DB_PATH || './data/app.db';
const schemaPath = path.join(__dirname, '..', 'db', 'schema.sql');

const adminUser = process.env.DEFAULT_ADMIN_USER || 'admin';
const adminPass = process.env.DEFAULT_ADMIN_PASS || 'admin123!';

const db = openDb(DB_PATH);
const schema = fs.readFileSync(schemaPath, 'utf-8');
db.exec(schema);

const insertSchool = db.prepare('INSERT OR IGNORE INTO schools(name, domain) VALUES (?, ?)');
insertSchool.run('default', 'local.test');

const schoolId = db.prepare('SELECT id FROM schools WHERE name=?').get('default').id;
const insertCourse = db.prepare('INSERT OR IGNORE INTO courses(name, school_id) VALUES (?, ?)');
insertCourse.run('default', schoolId);

const courseId = db.prepare('SELECT id FROM courses WHERE name=?').get('default').id;

const existing = db.prepare("SELECT id FROM users WHERE username=? AND role='admin'").get(adminUser);
if (!existing) {
  const pw_hash = bcrypt.hashSync(adminPass, 12);
  db.prepare(`INSERT INTO users(username, display_name, role, course_id, school_id, pw_hash) VALUES (?,?,?,?,?,?)`)
    .run(adminUser, 'Administrator', 'admin', courseId, schoolId, pw_hash);
  console.log(`Admin angelegt: ${adminUser} / ${adminPass}`);
} else {
  console.log(`Admin existiert bereits: ${adminUser}`);
}
console.log(`DB initialisiert unter: ${DB_PATH}`);
