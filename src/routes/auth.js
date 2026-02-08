const express = require('express');
const bcrypt = require('bcryptjs');

const { requireAuth } = require('../middleware/auth');

module.exports = function createAuthRouter({ db }) {
  const router = express.Router();

  router.get('/login', (req, res) => res.render('login', { error: null }));

  function findUserByLogin(login) {
    const raw = (login || '').toString().trim();
    if (!raw) return null;

    const atIndex = raw.indexOf('@');
    if (atIndex === -1) {
      return db.prepare(`
        SELECT u.id, u.username, u.display_name, u.role, u.pw_hash, u.expires_at, c.name AS course_name
        FROM users u LEFT JOIN courses c ON c.id=u.course_id
        WHERE u.username=? AND u.role IN ('admin','schooladmin')
        ORDER BY CASE WHEN u.role='admin' THEN 0 ELSE 1 END
        LIMIT 1
      `).get(raw);
    }

    const local = raw.slice(0, atIndex).trim();
    const domain = raw.slice(atIndex + 1).trim().toLowerCase();
    if (!local || !domain) return null;

    const domainParts = domain.split('.');
    if (domainParts.length > 1) {
      const coursePart = domainParts[0];
      const schoolDomain = domainParts.slice(1).join('.');
      const student = db.prepare(`
        SELECT u.id, u.username, u.display_name, u.role, u.pw_hash, u.expires_at, c.name AS course_name
        FROM users u
        JOIN courses c ON c.id=u.course_id
        JOIN schools s ON s.id=c.school_id
        WHERE lower(u.username)=lower(?)
          AND lower(c.name)=lower(?)
          AND lower(s.domain)=lower(?)
          AND u.role='student'
      `).get(local, coursePart, schoolDomain);
      if (student) return student;
    }

    const schooladmin = db.prepare(`
      SELECT u.id, u.username, u.display_name, u.role, u.pw_hash, u.expires_at, c.name AS course_name
      FROM users u
      LEFT JOIN courses c ON c.id=u.course_id
      JOIN schools s ON s.id=u.school_id
      WHERE lower(u.username)=lower(?)
        AND lower(s.domain)=lower(?)
        AND u.role='schooladmin'
      LIMIT 1
    `).get(local, domain);
    if (schooladmin) return schooladmin;

    return db.prepare(`
      SELECT u.id, u.username, u.display_name, u.role, u.pw_hash, u.expires_at, c.name AS course_name
      FROM users u
      LEFT JOIN teacher_courses tc ON tc.user_id=u.id
      LEFT JOIN courses c ON c.id=tc.course_id
      LEFT JOIN schools s ON s.id=c.school_id
      WHERE lower(u.username)=lower(?)
        AND lower(s.domain)=lower(?)
        AND u.role='teacher'
      LIMIT 1
    `).get(local, domain);
  }

  router.post('/login', (req, res) => {
    const { username, password } = req.body || {};
    const user = findUserByLogin(username);

    if (!user) return res.status(401).render('login', { error: req.t('auth.login_failed') });

    if (user.expires_at) {
      const now = new Date();
      const exp = new Date(user.expires_at + 'T23:59:59');
      if (now > exp) return res.status(403).render('login', { error: req.t('auth.account_expired') });
    }

    if (!bcrypt.compareSync(password || '', user.pw_hash)) {
      return res.status(401).render('login', { error: req.t('auth.login_failed') });
    }

    req.session.userId = user.id;
    req.session.role = user.role;
    return res.redirect('/');
  });

  router.get('/account', requireAuth, (req, res) => {
    return res.render('account', { error: null, success: null });
  });

  router.post('/account/password', requireAuth, (req, res) => {
    const currentPassword = (req.body.current_password || '').toString();
    const newPassword = (req.body.new_password || '').toString();
    const confirmPassword = (req.body.confirm_password || '').toString();

    if (!currentPassword || !newPassword || !confirmPassword) {
      return res.status(400).render('account', { error: req.t('auth.fields_required'), success: null });
    }
    if (newPassword.length < 6) {
      return res.status(400).render('account', { error: req.t('auth.new_password_min'), success: null });
    }
    if (newPassword !== confirmPassword) {
      return res.status(400).render('account', { error: req.t('auth.passwords_mismatch'), success: null });
    }

    const user = db.prepare('SELECT id, pw_hash FROM users WHERE id=?').get(req.session.userId);
    if (!user) {
      req.session.destroy(() => res.redirect('/login'));
      return;
    }
    if (!bcrypt.compareSync(currentPassword, user.pw_hash)) {
      return res.status(401).render('account', { error: req.t('auth.current_password_wrong'), success: null });
    }

    const newHash = bcrypt.hashSync(newPassword, 12);
    db.prepare('UPDATE users SET pw_hash=? WHERE id=?').run(newHash, user.id);
    return res.render('account', { error: null, success: req.t('auth.password_updated') });
  });

  function doLogout(req, res) {
    // Destroy session and remove cookie so the browser stops sending an orphaned sid.
    req.session.destroy(() => {
      try { res.clearCookie('connect.sid'); } catch (_) {}
      return res.redirect('/login');
    });
  }

  // Support both GET and POST so a simple <a href="/logout"> works.
  router.get('/logout', requireAuth, doLogout);
  router.post('/logout', requireAuth, doLogout);

  return router;
};
