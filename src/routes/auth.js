const express = require('express');
const bcrypt = require('bcrypt');

const { requireAuth } = require('../middleware/auth');

module.exports = function createAuthRouter({ db }) {
  const router = express.Router();

  router.get('/login', (req, res) => res.render('login', { error: null }));

  router.post('/login', (req, res) => {
    const { username, password } = req.body || {};
    const user = db.prepare(`
      SELECT u.id, u.username, u.display_name, u.role, u.pw_hash, u.expires_at, c.name AS course_name
      FROM users u LEFT JOIN courses c ON c.id=u.course_id
      WHERE u.username=?
    `).get((username || '').trim());

    if (!user) return res.status(401).render('login', { error: 'Login fehlgeschlagen.' });

    if (user.expires_at) {
      const now = new Date();
      const exp = new Date(user.expires_at + 'T23:59:59');
      if (now > exp) return res.status(403).render('login', { error: 'Account abgelaufen.' });
    }

    if (!bcrypt.compareSync(password || '', user.pw_hash)) {
      return res.status(401).render('login', { error: 'Login fehlgeschlagen.' });
    }

    req.session.userId = user.id;
    req.session.role = user.role;
    return res.redirect('/');
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
