const express = require('express');
const bcrypt = require('bcrypt');
const { parse } = require('csv-parse/sync');

const { requireRole } = require('../middleware/auth');
const { formatEmail } = require('../lib/address');
const { csvFieldNoQuotes } = require('../utils/csv');

module.exports = function createAdminRouter({ db }) {
  const router = express.Router();

  router.get('/admin/routes', requireRole('admin'), (req, res) => {
    return res.json({
      routes: [
        'GET /admin',
        'POST /admin/create-users',
        'POST /admin/import-csv',
        'POST /admin/delete-users',
        'GET /admin/download-created.csv',
        'GET /admin/download-created',
        'POST /admin/cleanup-expired',
        'GET /teacher',
        'POST /teacher/send-window/open',
        'POST /teacher/send-window/close',
        'POST /teacher/import-csv',
        'GET /teacher/download-created.csv',
        'POST /teacher/delete-users',
        'GET /logs'
      ]
    });
  });

  router.get('/admin', requireRole('admin'), (req, res) => {
    const courseFilter = (req.query.course_id || '').toString().trim();
    const courses = db.prepare('SELECT id, name FROM courses ORDER BY name').all();

    let users = [];
    if (courseFilter) {
      users = db.prepare(`
        SELECT u.id, u.username, u.display_name, u.role, u.expires_at, c.name AS course_name, c.id AS course_id
        FROM users u LEFT JOIN courses c ON c.id=u.course_id
        WHERE u.course_id = ?
        ORDER BY c.name, u.role, u.display_name
      `).all(Number(courseFilter));
    } else {
      users = db.prepare(`
        SELECT u.id, u.username, u.display_name, u.role, u.expires_at, c.name AS course_name, c.id AS course_id
        FROM users u LEFT JOIN courses c ON c.id=u.course_id
        ORDER BY c.name, u.role, u.display_name
      `).all();
    }

    const messagesStmt = courseFilter
      ? db.prepare(`
          SELECT m.id, m.subject, m.created_at,
                 su.display_name AS sender_name, su.username AS sender_username, sc.name AS sender_course
          FROM messages m
          JOIN users su ON su.id=m.sender_id
          LEFT JOIN courses sc ON sc.id=su.course_id
          WHERE m.is_draft=0 AND su.course_id = ?
          ORDER BY m.created_at DESC
          LIMIT 100
        `)
      : db.prepare(`
          SELECT m.id, m.subject, m.created_at,
                 su.display_name AS sender_name, su.username AS sender_username, sc.name AS sender_course
          FROM messages m
          JOIN users su ON su.id=m.sender_id
          LEFT JOIN courses sc ON sc.id=su.course_id
          WHERE m.is_draft=0
          ORDER BY m.created_at DESC
          LIMIT 100
        `);

    const messages = (courseFilter ? messagesStmt.all(Number(courseFilter)) : messagesStmt.all()).map(m => ({
      ...m,
      sender_email: formatEmail({ username: m.sender_username, courseName: m.sender_course }, process.env)
    }));

    // Post/Redirect/Get: show one-time import result after CSV upload
    const importResult = req.session.adminImportResult || null;
    if (req.session.adminImportResult) delete req.session.adminImportResult;

    return res.render('admin', { users, messages, importResult, courses, courseFilter });
  });

  router.post('/admin/create-users', requireRole('admin'), (req, res) => {
    const courseId = Number(req.body.course_id);
    if (!Number.isFinite(courseId)) return res.status(400).send('Kurs fehlt.');

    const usernames = [].concat(req.body.username || []);
    const displayNames = [].concat(req.body.display_name || []);
    const expires = [].concat(req.body.expires_at || []);
    const passwords = [].concat(req.body.password || []);
    const roles = [].concat(req.body.role || []);

    const created = [];
    const updated = [];

    const tx = db.transaction(() => {
      for (let i = 0; i < usernames.length; i++) {
        const username = (usernames[i] || '').toString().trim();
        if (!username) continue;
        const display = (displayNames[i] || username).toString().trim() || username;
        const expires_at = (expires[i] || '').toString().trim() || null;
        const role = ((roles[i] || 'student').toString().trim()) || 'student';
        const pwIn = (passwords[i] || '').toString().trim();
        const pw = pwIn || (Math.random().toString(36).slice(2, 10) + '!');
        const hash = bcrypt.hashSync(pw, 12);

        const existing = db.prepare('SELECT id FROM users WHERE username=? AND course_id=?').get(username, courseId);
        if (existing) {
          db.prepare('UPDATE users SET display_name=?, role=?, expires_at=? WHERE id=?').run(display, role, expires_at, existing.id);
          updated.push(username);
        } else {
          db.prepare('INSERT INTO users(username, display_name, role, course_id, pw_hash, expires_at) VALUES (?,?,?,?,?,?)')
            .run(username, display, role, courseId, hash, expires_at);
          created.push({ username, password: pw });
        }
      }
    });
    tx();

    req.session.lastImportCreated = created;
    return res.redirect('/admin?course_id=' + encodeURIComponent(String(courseId)));
  });

  router.post('/admin/import-csv', requireRole('admin'), (req, res) => {
    const csvText = (req.body.csv || '').toString();
    if (!csvText.trim()) return res.redirect('/admin');

    // For rendering the admin view in all code paths (including early returns).
    let courses = db.prepare('SELECT id, name FROM courses ORDER BY name').all();
    let courseFilter = '';

    let records;
    try {
      const firstLine = (csvText.split(/\r?\n/).find(l => l.trim().length) || '');
      const delimiter =
        firstLine.includes(';') ? ';' :
        firstLine.includes('\t') ? '\t' :
        ',';

      records = parse(csvText, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        bom: true,
        delimiter,
        relax_quotes: true,
        relax_column_count: true
      });
    } catch (e) {
      return res.status(400).send('CSV konnte nicht gelesen werden. Erwartet: Header-Zeile (Komma oder Semikolon), z. B. username,display_name,course,expires_at,password,role');
    }

    if (!records || records.length === 0) {
      const users = db.prepare(`
        SELECT u.id, u.username, u.display_name, u.role, u.expires_at, c.name AS course_name
        FROM users u LEFT JOIN courses c ON c.id=u.course_id
        ORDER BY c.name, u.role, u.display_name
      `).all();

      const messages = db.prepare(`
        SELECT m.id, m.subject, m.created_at,
               su.display_name AS sender_name, su.username AS sender_username, sc.name AS sender_course
        FROM messages m
        JOIN users su ON su.id=m.sender_id
        LEFT JOIN courses sc ON sc.id=su.course_id
        WHERE m.is_draft=0
        ORDER BY m.created_at DESC
        LIMIT 100
      `).all().map(m => ({
        ...m,
        sender_email: formatEmail({ username: m.sender_username, courseName: m.sender_course }, process.env)
      }));

      return res.render('admin', {
        users,
        messages,
        courses,
        courseFilter,
        importResult: { created: [], updated: [], errors: [{ row: {}, error: 'Keine Datensätze erkannt. Prüfen Sie Trennzeichen (Komma oder Semikolon) und Header.' }] }
      });
    }

    const ensureCourse = db.prepare('INSERT OR IGNORE INTO courses(name) VALUES (?)');
    const getCourse = db.prepare('SELECT id FROM courses WHERE name=?');
    const insUser = db.prepare('INSERT INTO users(username, display_name, role, course_id, pw_hash, expires_at) VALUES (?,?,?,?,?,?)');
    const updUser = db.prepare('UPDATE users SET display_name=?, role=?, course_id=?, expires_at=? WHERE username=?');

    const created = [];
    const updated = [];
    const errors = [];

    const tx = db.transaction(() => {
      for (const r of records) {
        const username = (r.username || '').trim();
        const display = (r.display_name || username).trim() || username;
        const course = (r.course || 'default').trim() || 'default';
        const role = (r.role || 'student').trim().toLowerCase();
        const expires_at = (r.expires_at || '').trim() || null;
        const password = (r.password || '').trim();

        if (!username) { errors.push({ row: r, error: 'username fehlt' }); continue; }
        if (!['student','teacher','admin'].includes(role)) { errors.push({ row: r, error: 'role ungültig' }); continue; }

        ensureCourse.run(course);
        const courseId = getCourse.get(course).id;

        const existing = db.prepare('SELECT id FROM users WHERE username=?').get(username);
        if (existing) {
          updUser.run(display, role, courseId, expires_at, username);
          updated.push(username);
        } else {
          const pw = password || (Math.random().toString(36).slice(2, 10) + '!');
          const hash = bcrypt.hashSync(pw, 12);
          insUser.run(username, display, role, courseId, hash, expires_at);
          created.push({ username, password: pw });
        }
      }
    });
    tx();

    req.session.lastImportCreated = created;
    req.session.adminImportResult = {
      createdCount: created.length,
      updatedCount: updated.length,
      created,
      updated,
      errors
    };

    // Post/Redirect/Get: avoid leaving "/admin/import-csv" in the address bar.
    return res.redirect('/admin');
  });

  router.post('/admin/delete-users', requireRole('admin'), (req, res) => {
    const ids = (req.body.user_ids || '').toString().split(',').map(s => s.trim()).filter(Boolean).map(Number).filter(Number.isFinite);
    if (!ids.length) return res.redirect('/admin');

    const meId = req.session.userId;
    const filtered = ids.filter(id => id !== meId);

    const tx = db.transaction(() => {
      for (const id of filtered) db.prepare('DELETE FROM users WHERE id=?').run(id);
    });
    tx();
    return res.redirect('/admin');
  });

  router.get('/admin/download-created.csv', requireRole('admin'), (req, res) => {
    const created = req.session.lastImportCreated || [];
    if (!created.length) return res.status(404).send('No recent import');

    // Unquoted CSV (matches import). We still include course name so Lehrkräfte/Admins can read it.
    const pwByUser = new Map(created.map(r => [r.username, r.password]));
    const usernames = [...pwByUser.keys()].filter(Boolean);
    const placeholders = usernames.map(() => '?').join(',');

    let rows = [];
    try {
      rows = db
        .prepare(
          `SELECT u.username, u.display_name, u.expires_at, u.course_id, c.name AS course_name
           FROM users u
           LEFT JOIN courses c ON c.id = u.course_id
           WHERE u.username IN (${placeholders})`
        )
        .all(...usernames);
    } catch (e) {
      return res.status(500).send(String(e));
    }

    // Preserve original order from the created list.
    const byUsername = new Map(rows.map(r => [r.username, r]));

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="created-users.csv"');
    res.write('username,display_name,course,expires_at,password\n');

    for (const row of created) {
      const info = byUsername.get(row.username) || {};
      res.write(
        [
          csvFieldNoQuotes(row.username),
          csvFieldNoQuotes(info.display_name),
          csvFieldNoQuotes(info.course_name || info.course_id),
          csvFieldNoQuotes(info.expires_at),
          csvFieldNoQuotes(pwByUser.get(row.username)),
        ].join(',') + '\n'
      );
    }

    return res.end();
  });

  router.get('/admin/download-created', requireRole('admin'), (req, res) => {
    return res.redirect('/admin/download-created.csv');
  });

  router.post('/admin/cleanup-expired', requireRole('admin'), (req, res) => {
    db.prepare("DELETE FROM users WHERE expires_at IS NOT NULL AND date(expires_at) < date('now')").run();
    return res.redirect('/admin');
  });

  return router;
};
