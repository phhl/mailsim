const express = require('express');

const { requireAuth } = require('../middleware/auth');
const { formatEmail } = require('../lib/address');
const { sendOrDraft } = require('../services/mail');
const { toBerlinLocal } = require('../utils/time');
const { getVisibleUsers } = require('../services/visibility');
const { isSendWindowOpen } = require('../services/sendWindow');

module.exports = function createMailRouter({ db }) {
  const router = express.Router();

  router.get('/', requireAuth, (req, res) => res.redirect('/mailbox/INBOX'));

  router.get('/mailbox/:folder', requireAuth, (req, res) => {
    const folder = (req.params.folder || 'INBOX').toUpperCase();
    const allowed = new Set(['INBOX','SENT','DRAFTS','TRASH']);
    if (!allowed.has(folder)) return res.status(400).send('Bad folder');

    const items = db.prepare(`
      SELECT d.id AS delivery_id, d.folder, d.is_read, d.created_at,
             m.id AS message_id, m.subject, m.body_text,
             su.username AS sender_username, su.display_name AS sender_name,
             sc.name AS sender_course
      FROM deliveries d
      JOIN messages m ON m.id=d.message_id
      JOIN users su ON su.id=m.sender_id
      LEFT JOIN courses sc ON sc.id=su.course_id
      WHERE d.owner_user_id=? AND d.folder=? AND d.deleted_at IS NULL
      ORDER BY d.created_at DESC
      LIMIT 200
    `).all(req.session.userId, folder);

    const mapped = items.map(it => ({
      ...it,
      created_at_local: toBerlinLocal(it.created_at),
      sender_email: formatEmail({ username: it.sender_username, courseName: it.sender_course }, process.env),
      snippet: (it.body_text || '').slice(0, 120)
    }));

    return res.render('mailbox', { folder, items: mapped });
  });

  function recipientsForMessage(messageId, viewerRole, viewerIsSender, viewerCanSeeBcc = false) {
    const rows = db.prepare(`
      SELECT r.type, u.username, u.display_name, c.name AS course_name, u.id AS user_id
      FROM recipients r
      JOIN users u ON u.id=r.user_id
      LEFT JOIN courses c ON c.id=u.course_id
      WHERE r.message_id=?
      ORDER BY CASE r.type WHEN 'TO' THEN 1 WHEN 'CC' THEN 2 ELSE 3 END, u.display_name
    `).all(messageId);

    return rows
      .filter(r => {
        if (viewerRole === 'admin') return true;
        if (r.type !== 'BCC') return true;
        // Normal mail behavior: BCC is hidden for recipients.
        // The sender may see their own BCC list; teachers/admin may see it for supervision.
        if (viewerRole === 'student') return viewerIsSender;
        return viewerIsSender || viewerCanSeeBcc;
      })
      .map(r => ({
        type: r.type,
        user_id: r.user_id,
        display_name: r.display_name,
        email: formatEmail({ username: r.username, courseName: r.course_name }, process.env)
      }));
  }

  // Backward-compatible redirect (older links)
  router.get('/message/:messageId', requireAuth, (req, res) => {
    return res.redirect(302, `/mail/${encodeURIComponent(req.params.messageId)}`);
  });

  // Unified mail view for admin/teacher/student with role-based authorization
  router.get('/mail/:messageId', requireAuth, (req, res) => {
    const messageId = Number(req.params.messageId);
    if (!Number.isFinite(messageId)) return res.status(400).send('Bad id');

    // Kontext steuert, ob die Mailbox-Sidebar angezeigt wird.
    // mailbox (Default): Sidebar sichtbar
    // admin/teacher: Sidebar ausgeblendet (Detailansicht aus Verwaltungsseiten)
    const context = String(req.query.context || 'mailbox');
    const showSidebar = context === 'mailbox';
    // When we show the mailbox sidebar, highlight the folder the user came from.
    // (The actual delivery.folder might be virtual, e.g. 'COURSE' for teacher course-wide view.)
    const requestedFolder = showSidebar ? String(req.query.folder || req.query.f || 'INBOX') : null;

    const role = req.session.role;
    const meId = req.session.userId;

    const msg = db.prepare(`
      SELECT m.*, su.username AS sender_username, su.display_name AS sender_name, sc.name AS sender_course
      FROM messages m
      JOIN users su ON su.id=m.sender_id
      LEFT JOIN courses sc ON sc.id=su.course_id
      WHERE m.id=?
    `).get(messageId);

    if (!msg) return res.status(404).send('Nicht gefunden.');

    // Access control
    // - admin: any message
    // - student: only messages they have a delivery for (inbox, sent, drafts, etc.)
    // - teacher: delivery messages, plus course-wide visibility of student sent mails in their own course
    let delivery = null;
    let courseWideTeacherView = false;
    if (role !== 'admin') {
      delivery = db.prepare('SELECT * FROM deliveries WHERE message_id=? AND owner_user_id=? AND deleted_at IS NULL')
        .get(messageId, meId);

      if (!delivery && role === 'teacher') {
        const me = db.prepare('SELECT course_id FROM users WHERE id=?').get(meId);
        const sender = db.prepare('SELECT course_id, role FROM users WHERE id=?').get(msg.sender_id);
        if (me?.course_id && sender?.course_id === me.course_id && sender?.role === 'student') {
          courseWideTeacherView = true;
          delivery = { folder: 'COURSE' };
        }
      }

      if (!delivery) return res.status(404).send('Nicht gefunden.');
    } else {
      delivery = db.prepare('SELECT * FROM deliveries WHERE message_id=? LIMIT 1').get(messageId) || { folder: 'INBOX' };
    }

    const viewerIsSender = msg.sender_id === meId;
    // Teachers and admins can see BCC; students can see BCC only on messages they sent.
    const recips = recipientsForMessage(messageId, role, viewerIsSender, role !== 'student');

    // mark read if this is a real delivery for the viewer (avoid side effects for course-wide teacher views)
    if (role !== 'admin' && !courseWideTeacherView) {
      db.prepare('UPDATE deliveries SET is_read=1 WHERE message_id=? AND owner_user_id=?').run(messageId, meId);
    }

    // Sidebar highlighting: virtual course view maps to SENT.
    const activeFolder = showSidebar
      ? ((delivery.folder === 'COURSE') ? 'SENT' : requestedFolder)
      : null;

    return res.render('message', {
      folder: delivery.folder,
      activeFolder,
      showSidebar,
      me: {
        id: meId,
        role,
        username: req.session.username,
        display_name: req.session.display_name,
        course_id: req.session.course_id,
        course_name: req.session.course_name
      },
      mail: {
        ...msg,
        created_at_local: toBerlinLocal(msg.created_at),
        sender_email: formatEmail({ username: msg.sender_username, courseName: msg.sender_course }, process.env)
      },
      recipients: recips
    });
  });

  router.get('/compose', requireAuth, (req, res) => {
    const meId = req.session.userId;
    const users = getVisibleUsers(db, meId, req.session.role);

    const parseIds = (s) => (s || '').toString()
      .split(',')
      .map(x => x.trim())
      .filter(Boolean)
      .map(Number)
      .filter(Number.isFinite);

    return res.render('compose', {
      users: users.map(u => ({
        id: u.id,
        label: `${u.display_name} <${formatEmail({ username: u.username, courseName: u.course_name }, process.env)}>`
      })),
      preset: {
        subject: req.query.subject || '',
        body_html: req.query.body || '',
        to: parseIds(req.query.to),
        cc: parseIds(req.query.cc),
        bcc: parseIds(req.query.bcc)
      },
      error: null
    });
  });

  router.post('/compose', requireAuth, (req, res) => {
    const meId = req.session.userId;

    // Empfänger werden client-seitig als kommaseparierte ID-Liste geliefert.
    // Wir verwenden bewusst *_ids als Feldnamen, um nicht mit "to/cc/bcc" UI-Inputs zu kollidieren.
    const to = (req.body.to_ids || '').split(',').map(s => s.trim()).filter(Boolean).map(Number).filter(Number.isFinite);
    const cc = (req.body.cc_ids || '').split(',').map(s => s.trim()).filter(Boolean).map(Number).filter(Number.isFinite);
    const bcc = (req.body.bcc_ids || '').split(',').map(s => s.trim()).filter(Boolean).map(Number).filter(Number.isFinite);

    // Versandfenster: Schüler dürfen nur senden, wenn Lehrkraft freigeschaltet hat
    const action = (req.body.action === 'draft') ? 'draft' : 'send';
    if (req.session.role === 'student' && action === 'send') {
      const me = db.prepare('SELECT course_id FROM users WHERE id=?').get(meId);
      if (!isSendWindowOpen(db, me?.course_id)) {
        const users = getVisibleUsers(db, meId, req.session.role);
        return res.status(403).render('compose', {
          users: users.map(u => ({
            id: u.id,
            label: `${u.display_name} <${formatEmail({ username: u.username, courseName: u.course_name }, process.env)}>`
          })),
          preset: { subject: req.body.subject || '', body_html: req.body.body_html || '', to, cc, bcc: [] },
          error: 'Versand ist aktuell gesperrt. Die Lehrkraft muss das Versandfenster öffnen.'
        });
      }
    }

    const payload = {
      to, cc, bcc,
      subject: req.body.subject || '',
      body_html: req.body.body_html || '',
      action
    };

    try {
      const result = sendOrDraft(db, { id: meId, role: req.session.role }, payload);
      if (result.isDraft) return res.redirect('/mailbox/DRAFTS');
      return res.redirect('/mailbox/SENT');
    } catch (e) {
      const users = getVisibleUsers(db, meId, req.session.role);
      return res.status(400).render('compose', {
        users: users.map(u => ({
          id: u.id,
          label: `${u.display_name} <${formatEmail({ username: u.username, courseName: u.course_name }, process.env)}>`
        })),
        preset: {
          subject: req.body.subject || '',
          body_html: req.body.body_html || '',
          to, cc, bcc
        },
        error: e.message || 'Fehler'
      });
    }
  });

  // Reply / Reply‑All / Forward (mit korrekter Empfängerlogik)
  function getMessageForAction(messageId) {
    return db.prepare(`
      SELECT m.*, su.id AS sender_id, su.display_name AS sender_name, su.username AS sender_username, sc.name AS sender_course
      FROM messages m
      JOIN users su ON su.id=m.sender_id
      LEFT JOIN courses sc ON sc.id=su.course_id
      WHERE m.id=?
    `).get(messageId);
  }

  function canAccessMessage(messageId, meId, meRole) {
    if (meRole === 'admin') return true;
    return !!db.prepare('SELECT 1 FROM deliveries WHERE message_id=? AND owner_user_id=? AND deleted_at IS NULL').get(messageId, meId);
  }

  function buildQuotedHtml(msg) {
    return `<blockquote>
      <p><strong>Am ${msg.created_at} schrieb ${msg.sender_name}:</strong></p>
      ${msg.body_html}
    </blockquote>`;
  }

  router.get('/reply/:messageId', requireAuth, (req, res) => {
    const messageId = Number(req.params.messageId);
    const meId = req.session.userId;
    const role = req.session.role;

    if (!canAccessMessage(messageId, meId, role)) return res.status(404).send('Nicht gefunden.');

    const msg = getMessageForAction(messageId);
    if (!msg) return res.status(404).send('Nicht gefunden.');

    const subject = (msg.subject || '').toLowerCase().startsWith('re:') ? msg.subject : `Re: ${msg.subject}`;
    const body = `<p></p>${buildQuotedHtml(msg)}`;

    const params = new URLSearchParams({
      subject,
      body,
      to: String(msg.sender_id)
    });
    return res.redirect('/compose?' + params.toString());
  });

  router.get('/reply-all/:messageId', requireAuth, (req, res) => {
    const messageId = Number(req.params.messageId);
    const meId = req.session.userId;
    const role = req.session.role;

    if (!canAccessMessage(messageId, meId, role)) return res.status(404).send('Nicht gefunden.');

    const msg = getMessageForAction(messageId);
    if (!msg) return res.status(404).send('Nicht gefunden.');

    // Reply-All: TO = original sender (if not me) + original TO/CC (no BCC), excluding me.
    const rec = db.prepare(`
      SELECT r.type, r.user_id
      FROM recipients r
      WHERE r.message_id=? AND r.type IN ('TO','CC')
    `).all(messageId);

    const toSet = new Set();
    const ccSet = new Set();

    if (msg.sender_id !== meId) toSet.add(msg.sender_id);

    for (const r of rec) {
      if (r.user_id === meId) continue;
      if (r.type === 'TO') toSet.add(r.user_id);
      if (r.type === 'CC') ccSet.add(r.user_id);
    }

    // De-dup CC vs TO
    for (const id of toSet) ccSet.delete(id);

    const subject = (msg.subject || '').toLowerCase().startsWith('re:') ? msg.subject : `Re: ${msg.subject}`;
    const body = `<p></p>${buildQuotedHtml(msg)}`;

    const params = new URLSearchParams({
      subject,
      body,
      to: Array.from(toSet).join(','),
      cc: Array.from(ccSet).join(',')
    });
    return res.redirect('/compose?' + params.toString());
  });

  router.get('/forward/:messageId', requireAuth, (req, res) => {
    const messageId = Number(req.params.messageId);
    const meId = req.session.userId;
    const role = req.session.role;

    if (!canAccessMessage(messageId, meId, role)) return res.status(404).send('Nicht gefunden.');

    const msg = getMessageForAction(messageId);
    if (!msg) return res.status(404).send('Nicht gefunden.');

    const subject = (msg.subject || '').toLowerCase().startsWith('fw:') ? msg.subject : `Fw: ${msg.subject}`;
    const body = `<p></p>${buildQuotedHtml(msg)}`;

    const params = new URLSearchParams({ subject, body });
    return res.redirect('/compose?' + params.toString());
  });

  // Resolve an entered email/label to a user id (for manual entry)
  router.get('/resolve', requireAuth, (req, res) => {
    const meId = req.session.userId;
    const term = (req.query.term || '').toString().trim();
    if (!term) return res.json({ ok: false });

    const m = term.match(/<([^>]+)>/);
    const email = (m ? m[1] : term).trim().toLowerCase();

    const visible = getVisibleUsers(db, meId, req.session.role);
    for (const u of visible) {
      const addr = formatEmail({ username: u.username, courseName: u.course_name }, process.env).toLowerCase();
      if (addr === email || u.username.toLowerCase() === email) {
        return res.json({ ok: true, id: u.id, label: `${u.display_name} <${addr}>` });
      }
    }
    return res.json({ ok: false });
  });

  router.get('/userlabel', requireAuth, (req, res) => {
    const meId = req.session.userId;
    const id = Number(req.query.id);
    if (!Number.isFinite(id)) return res.json({ ok: false });

    const visible = getVisibleUsers(db, meId, req.session.role);
    const u = visible.find(x => x.id === id);
    if (!u) return res.json({ ok: false });

    const email = formatEmail({ username: u.username, courseName: u.course_name }, process.env);
    return res.json({ ok: true, id: u.id, label: `${u.display_name} <${email}>` });
  });

  // ---------- Addressbook (Ajax autocomplete) ----------
  router.get('/addressbook', requireAuth, (req, res) => {
    const meId = req.session.userId;
    const q = (req.query.q || '').toString().toLowerCase();

    const meRole = req.session.role;
    const me = db.prepare('SELECT course_id FROM users WHERE id=?').get(meId);
    const params = [`%${q}%`, `%${q}%`, `%${q}%`];

    let rows;
    if (meRole === 'admin') {
      rows = db.prepare(`
        SELECT u.id, u.username, u.display_name, c.name AS course_name
        FROM users u LEFT JOIN courses c ON c.id=u.course_id
        WHERE u.id != ?
          AND (u.expires_at IS NULL OR date(u.expires_at) >= date('now'))
          AND (lower(u.display_name) LIKE ? OR lower(u.username) LIKE ? OR lower(c.name) LIKE ?)
        ORDER BY c.name, u.display_name
        LIMIT 20
      `).all(meId, ...params);
    } else {
      rows = db.prepare(`
        SELECT u.id, u.username, u.display_name, u.role, c.name AS course_name
        FROM users u LEFT JOIN courses c ON c.id=u.course_id
        WHERE u.id != ?
          AND (u.expires_at IS NULL OR date(u.expires_at) >= date('now'))
          AND (lower(u.display_name) LIKE ? OR lower(u.username) LIKE ? OR lower(c.name) LIKE ?)
          AND (
            (u.course_id IS NOT NULL AND u.course_id = ?)
            OR u.role IN ('teacher','admin')
          )
        ORDER BY c.name, u.role, u.display_name
        LIMIT 20
      `).all(meId, ...params, me?.course_id ?? -1);
    }

    return res.json(rows.map(u => ({
      id: u.id,
      label: `${u.display_name} <${formatEmail({ username: u.username, courseName: u.course_name }, process.env)}>`
    })));
  });

  return router;
};
