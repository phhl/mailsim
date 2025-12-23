const express = require('express');
const bcrypt = require('bcrypt');
const { parse } = require('csv-parse/sync');

const { requireRole } = require('../middleware/auth');
const { formatEmail } = require('../lib/address');
const { toBerlinLocal } = require('../utils/time');
const { csvFieldNoQuotes } = require('../utils/csv');
const { isSendWindowOpen, setSendWindow, closeSendWindow } = require('../services/sendWindow');

module.exports = function createTeacherRouter({ db }) {
  const router = express.Router();

  // ---------- Logs (ohne Inhalte) ----------
  router.get('/logs', requireRole('teacher','admin'), (req, res) => {
    const meId = req.session.userId;
    const role = req.session.role;

    let logs = [];
    if (role === 'admin') {
      logs = db.prepare(`
        SELECT l.id, l.created_at,
               su.display_name AS sender_name, su.username AS sender_username, sc.name AS sender_course
        FROM mail_logs l
        JOIN users su ON su.id=l.sender_id
        LEFT JOIN courses sc ON sc.id=su.course_id
        ORDER BY l.created_at DESC
        LIMIT 300
      `).all();
    } else {
      const me = db.prepare('SELECT course_id FROM users WHERE id=?').get(meId);
      logs = db.prepare(`
        SELECT l.id, l.created_at,
               su.display_name AS sender_name, su.username AS sender_username, sc.name AS sender_course
        FROM mail_logs l
        JOIN users su ON su.id=l.sender_id
        LEFT JOIN courses sc ON sc.id=su.course_id
        WHERE su.course_id=?
        ORDER BY l.created_at DESC
        LIMIT 300
      `).all(me?.course_id ?? -1);
    }

    let recRows = [];
    if (logs.length) {
      const ids = logs.map(l => l.id);
      const placeholders = ids.map(() => '?').join(',');
      const stmt = db.prepare(`
        SELECT r.log_id, r.type, u.display_name, u.username, c.name AS course_name
        FROM mail_log_recipients r
        JOIN users u ON u.id=r.user_id
        LEFT JOIN courses c ON c.id=u.course_id
        WHERE r.log_id IN (${placeholders})
        ORDER BY r.log_id, r.type, u.display_name
      `);
      recRows = stmt.all(...ids);
    }

    const grouped = new Map();
    for (const row of recRows) {
      const key = row.log_id;
      if (!grouped.has(key)) grouped.set(key, { TO: [], CC: [], BCC: [] });
      const email = formatEmail({ username: row.username, courseName: row.course_name }, process.env);
      grouped.get(key)[row.type].push(`${row.display_name} <${email}>`);
    }

    const view = logs.map(l => ({
      ...l,
      created_at_local: toBerlinLocal(l.created_at),
      sender_email: formatEmail({ username: l.sender_username, courseName: l.sender_course }, process.env),
      to: (grouped.get(l.id)?.TO || []).join(', '),
      cc: (grouped.get(l.id)?.CC || []).join(', '),
      bcc: (grouped.get(l.id)?.BCC || []).join(', ')
    }));

    return res.render('logs', { logs: view });
  });

  // ---------- Teacher ----------
  router.get('/teacher', requireRole('teacher','admin'), (req, res) => {
    const meId = req.session.userId;
    const role = req.session.role;

    const me = db.prepare('SELECT u.id, u.course_id, c.name AS course_name FROM users u LEFT JOIN courses c ON c.id=u.course_id WHERE u.id=?').get(meId);
    const courseId = me?.course_id || null;

    const canCreate = role === 'admin' || ((process.env.TEACHER_CAN_CREATE || '0') === '1');
    const windowOpen = role === 'admin' ? true : isSendWindowOpen(db, courseId);
    const row = courseId ? db.prepare('SELECT open_until FROM course_send_windows WHERE course_id=?').get(courseId) : null;

    let users = [];
    if (role === 'admin') {
      users = db.prepare(`
        SELECT u.id, u.username, u.display_name, u.role, u.expires_at, c.name AS course_name
        FROM users u LEFT JOIN courses c ON c.id=u.course_id
        ORDER BY c.name, u.role, u.display_name
      `).all();
    } else {
      users = db.prepare(`
        SELECT u.id, u.username, u.display_name, u.role, u.expires_at, c.name AS course_name
        FROM users u LEFT JOIN courses c ON c.id=u.course_id
        WHERE u.course_id=?
        ORDER BY u.role, u.display_name
      `).all(courseId);
    }

    // Post/Redirect/Get: show one-time import result after CSV upload
    const importResult = req.session.teacherImportResult || null;
    if (req.session.teacherImportResult) delete req.session.teacherImportResult;

    // Course-wide sent overview (teacher) / global sent overview (admin)
    let sentOverview = [];
    try {
      const params = [];
      let whereCourse = '';
      if (role !== 'admin') {
        whereCourse = 'AND s.course_id = ?';
        params.push(courseId);
      }

      // Only real SENT: messages that are not drafts and that have a SENT delivery for the sender.
      // Only from students: sender role must be student.
      const base = db.prepare(`
        SELECT
          m.id AS message_id,
          m.created_at,
          m.subject,
          m.body_html,
          m.body_text,
          s.display_name AS sender_name,
          s.username AS sender_username,
          c.name AS course_name
        FROM messages m
        JOIN deliveries d ON d.message_id = m.id AND d.folder = 'SENT' AND d.owner_user_id = m.sender_id AND d.deleted_at IS NULL
        JOIN users s ON s.id = m.sender_id
        LEFT JOIN courses c ON c.id = s.course_id
        WHERE m.is_draft = 0
          AND s.role = 'student'
          ${whereCourse}
        ORDER BY m.created_at DESC
        LIMIT 500
      `).all(...params);

      const recStmt = db.prepare(`
        SELECT r.type, u.display_name, u.username, c2.name AS course_name
        FROM recipients r
        JOIN users u ON u.id = r.user_id
        LEFT JOIN courses c2 ON c2.id = u.course_id
        WHERE r.message_id = ?
        ORDER BY CASE r.type WHEN 'TO' THEN 1 WHEN 'CC' THEN 2 ELSE 3 END, u.display_name
      `);

      sentOverview = base.map(m => {
        const recRows = recStmt.all(m.message_id);
        const buckets = { TO: [], CC: [], BCC: [] };
        for (const r of recRows) {
          const email = formatEmail({ username: r.username, courseName: r.course_name }, process.env);
          buckets[r.type] = buckets[r.type] || [];
          buckets[r.type].push(`${r.display_name} <${email}>`);
        }

        const previewSource = m.body_text || (m.body_html || '').replace(/<[^>]*>/g, '');
        const preview = String(previewSource).replace(/\s+/g, ' ').trim().slice(0, 120);

        return {
          ...m,
          created_at_local: toBerlinLocal(m.created_at),
          sender_email: formatEmail({ username: m.sender_username, courseName: m.course_name }, process.env),
          to_recipients: buckets.TO.join(', '),
          cc_recipients: buckets.CC.join(', '),
          bcc_recipients: buckets.BCC.join(', '),
          preview
        };
      });
    } catch (e) {
      // non-fatal; keep page usable
      sentOverview = [];
    }

    return res.render('teacher', {
      me: { ...me, role },
      users,
      canCreate,
      windowOpen,
      openUntil: row?.open_until || null,
      importResult,
      sentOverview
    });
  });

  router.post('/teacher/send-window/open', requireRole('teacher','admin'), (req, res) => {
    const meId = req.session.userId;
    const role = req.session.role;
    if (role === 'admin') return res.redirect('/teacher');

    const me = db.prepare('SELECT course_id FROM users WHERE id=?').get(meId);
    const courseId = me?.course_id;
    if (!courseId) return res.status(400).send('Kein Kurs gesetzt.');

    const minutes = Number(req.body.minutes || process.env.SEND_WINDOW_MINUTES || 20);
    setSendWindow(db, courseId, Math.max(1, Math.min(minutes, 240)));
    return res.redirect('/teacher');
  });

  router.post('/teacher/send-window/close', requireRole('teacher','admin'), (req, res) => {
    const meId = req.session.userId;
    const role = req.session.role;
    if (role === 'admin') return res.redirect('/teacher');

    const me = db.prepare('SELECT course_id FROM users WHERE id=?').get(meId);
    const courseId = me?.course_id;
    if (courseId) closeSendWindow(db, courseId);
    return res.redirect('/teacher');
  });

  router.post('/teacher/import-csv', requireRole('teacher','admin'), (req, res) => {
    const role = req.session.role;
    const canCreate = role === 'admin' || ((process.env.TEACHER_CAN_CREATE || '0') === '1');
    if (!canCreate) return res.status(403).send('Nicht erlaubt.');

    const meId = req.session.userId;
    const me = db.prepare('SELECT u.id, u.course_id, c.name AS course_name FROM users u LEFT JOIN courses c ON c.id=u.course_id WHERE u.id=?').get(meId);
    const courseId = me?.course_id;
    if (!courseId) return res.status(400).send('Kein Kurs gesetzt.');

    const csvText = (req.body.csv || '').toString();
    if (!csvText.trim()) return res.redirect('/teacher');

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
      return res.status(400).send('CSV konnte nicht gelesen werden.');
    }

    const insUser = db.prepare('INSERT INTO users(username, display_name, role, course_id, pw_hash, expires_at) VALUES (?,?,?,?,?,?)');
    const updUser = db.prepare('UPDATE users SET display_name=?, expires_at=? WHERE username=? AND course_id=?');

    const created = [];
    const updated = [];
    const errors = [];

    const tx = db.transaction(() => {
      for (const r of records) {
        const username = (r.username || '').trim();
        const display = (r.display_name || username).trim() || username;
        const expires_at = (r.expires_at || '').trim() || null;
        const password = (r.password || '').trim();

        if (!username) { errors.push({ row: r, error: 'username fehlt' }); continue; }

        const existing = db.prepare('SELECT id FROM users WHERE username=? AND course_id=?').get(username, courseId);
        if (existing) {
          updUser.run(display, expires_at, username, courseId);
          updated.push(username);
        } else {
          const pw = password || (Math.random().toString(36).slice(2, 10) + '!');
          const hash = bcrypt.hashSync(pw, 12);
          insUser.run(username, display, 'student', courseId, hash, expires_at);
          created.push({ username, display_name: display, expires_at, course_id: courseId, password: pw });
        }
      }
    });
    tx();

    req.session.lastTeacherImportCreated = created;

    // Post/Redirect/Get: keep URL stable and avoid resubmission on refresh.
    req.session.teacherImportResult = { created, updated, errors };
    return res.redirect('/teacher');
  });

  router.post('/teacher/create-users', requireRole('teacher','admin'), (req, res) => {
    const role = req.session.role;
    const canCreate = role === 'admin' || ((process.env.TEACHER_CAN_CREATE || '0') === '1');
    if (!canCreate) return res.status(403).send('Nicht erlaubt.');

    const meId = req.session.userId;
    const me = db.prepare('SELECT course_id FROM users WHERE id=?').get(meId);
    const courseId = me?.course_id;
    if (!courseId) return res.status(400).send('Kein Kurs gesetzt.');

    const usernames = [].concat(req.body.username || []);
    const displayNames = [].concat(req.body.display_name || []);
    const expires = [].concat(req.body.expires_at || []);
    const passwords = [].concat(req.body.password || []);

    const created = [];
    const updated = [];
    const errors = [];

    const tx = db.transaction(() => {
      for (let i = 0; i < usernames.length; i++) {
        const username = (usernames[i] || '').toString().trim();
        if (!username) continue;
        const display = (displayNames[i] || username).toString().trim() || username;
        const expires_at = (expires[i] || '').toString().trim() || null;
        const pwIn = (passwords[i] || '').toString().trim();

        const existing = db.prepare('SELECT id FROM users WHERE username=? AND course_id=?').get(username, courseId);
        if (existing) {
          db.prepare('UPDATE users SET display_name=?, expires_at=? WHERE id=?').run(display, expires_at, existing.id);
          updated.push(username);
        } else {
          const pw = pwIn || (Math.random().toString(36).slice(2, 10) + '!');
          const hash = bcrypt.hashSync(pw, 12);
          db.prepare('INSERT INTO users(username, display_name, role, course_id, pw_hash, expires_at) VALUES (?,?,?,?,?,?)')
            .run(username, display, 'student', courseId, hash, expires_at);
          created.push({ username, display_name: display, expires_at, course_id: courseId, password: pw });
        }
      }
    });
    tx();

    req.session.lastTeacherImportCreated = created;
    req.session.teacherImportResult = {
      createdCount: created.length,
      updatedCount: updated.length,
      created,
      updated,
      errors
    };
    return res.redirect('/teacher');
  });

  router.get('/teacher/download-created.csv', requireRole('teacher','admin'), (req, res) => {
    const created = req.session.lastTeacherImportCreated || [];
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="created-users.csv"');

    // Unified CSV format (no quotes), compatible with both teacher and admin imports.
    // Fields: username,display_name,course,expires_at,password
    let courseName = '';
    if (created[0]?.course_id) {
      courseName = db.prepare('SELECT name FROM courses WHERE id=?').get(created[0].course_id)?.name || '';
    }

    res.write('username,display_name,course,expires_at,password\n');
    for (const row of created) {
      const u = csvFieldNoQuotes(row.username);
      const d = csvFieldNoQuotes(row.display_name);
      const c = csvFieldNoQuotes(courseName || row.course || '');
      const e = csvFieldNoQuotes(row.expires_at);
      const p = csvFieldNoQuotes(row.password);
      res.write(`${u},${d},${c},${e},${p}\n`);
    }
    return res.end();
  });

  router.post('/teacher/delete-users', requireRole('teacher','admin'), (req, res) => {
    const role = req.session.role;
    const meId = req.session.userId;
    const ids = (req.body.user_ids || '').toString().split(',').map(s => s.trim()).filter(Boolean).map(Number).filter(Number.isFinite);
    if (!ids.length) return res.redirect('/teacher');

    if (role === 'admin') {
      const tx = db.transaction(() => {
        for (const id of ids) if (id !== meId) db.prepare('DELETE FROM users WHERE id=?').run(id);
      });
      tx();
      return res.redirect('/teacher');
    }

    const me = db.prepare('SELECT course_id FROM users WHERE id=?').get(meId);
    const courseId = me?.course_id;
    const tx = db.transaction(() => {
      for (const id of ids) {
        if (id === meId) continue;
        db.prepare("DELETE FROM users WHERE id=? AND course_id=? AND role='student'").run(id, courseId);
      }
    });
    tx();
    return res.redirect('/teacher');
  });

  return router;
};
