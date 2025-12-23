require('dotenv').config({ path: process.env.ENV_FILE || '.env' });

const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');

const { openDb } = require('./db');
const { formatEmail } = require('./lib/address');
const { isSendWindowOpen } = require('./services/sendWindow');

const createAuthRouter = require('./routes/auth');
const createMailRouter = require('./routes/mail');
const createTeacherRouter = require('./routes/teacher');
const createAdminRouter = require('./routes/admin');

const app = express();
const isProd = process.env.NODE_ENV === 'production';
app.set('trust proxy', 1);

const DB_PATH = process.env.DB_PATH || './data/app.db';
const db = openDb(DB_PATH);

// Ensure schema additions exist (idempotent)
try {
  const schemaSql = fs.readFileSync(path.join(__dirname, 'db', 'schema.sql'), 'utf-8');
  db.exec(schemaSql);
} catch (e) {
  console.warn('Schema konnte nicht geladen werden:', e.message);
}

// ---------- Hardening ----------
app.use(helmet({
  contentSecurityPolicy: false // keep simple for Quill CDN; tighten if you self-host assets
}));
app.use(rateLimit({ windowMs: 60_000, max: 300 }));

// ---------- View engine ----------
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use((req, res, next) => {
  res.locals.assetVersion = process.env.ASSET_VERSION || 'v19';
  next();
});

// ---------- Parsers ----------
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(express.json({ limit: '1mb' }));

// ---------- Session ----------
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: { httpOnly: true, sameSite: 'lax', secure: isProd, maxAge: 1000 * 60 * 60 * 24 * 7 }
}));

// ---------- Inject user for templates ----------
app.use((req, res, next) => {
  if (req.session?.userId) {
    const user = db.prepare(`
      SELECT u.id, u.username, u.display_name, u.role, u.course_id, u.expires_at, c.name AS course_name
      FROM users u LEFT JOIN courses c ON c.id=u.course_id
      WHERE u.id=?
    `).get(req.session.userId);

    // expired -> force logout
    if (user?.expires_at) {
      const now = new Date();
      const exp = new Date(user.expires_at + 'T23:59:59');
      if (now > exp) {
        req.session.destroy(() => res.redirect('/login'));
        return;
      }
    }

    const sendWindowOpen = user
      ? (user.role === 'admin' ? true : isSendWindowOpen(db, user.course_id))
      : false;

    res.locals.me = user ? {
      ...user,
      send_window_open: sendWindowOpen,
      email: formatEmail({ username: user.username, courseName: user.course_name }, process.env)
    } : null;
  } else {
    res.locals.me = null;
  }
  next();
});

// ---------- Static assets ----------
app.use('/assets', express.static(path.join(__dirname, 'public', 'assets')));

// ---------- Routes ----------
app.use(createAuthRouter({ db }));
app.use(createMailRouter({ db }));
app.use(createTeacherRouter({ db }));
app.use(createAdminRouter({ db }));

module.exports = { app, db };
