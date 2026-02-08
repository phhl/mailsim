require("dotenv").config({ path: process.env.ENV_FILE || ".env" });

const express = require("express");
const session = require("express-session");
const { RedisStore } = require("connect-redis");
const { createClient } = require("redis");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const path = require("path");
const fs = require("fs");

const {
  ensureSessionSecret,
  needsSetup,
  isDatabaseReady,
} = require("./utils/setup");

const { openDb } = require("./db");
const { formatEmail, formatLogin } = require("./lib/address");
const {
  isSendWindowOpen,
  isAttachmentsEnabled,
} = require("./services/sendWindow");
const { createTranslator } = require("./utils/i18n");

const createAuthRouter = require("./routes/auth");
const createSetupRouter = require("./routes/setup");
const createMailRouter = require("./routes/mail");
const createTeacherRouter = require("./routes/teacher");
const createAdminRouter = require("./routes/admin");
const createSchoolAdminRouter = require("./routes/schooladmin");

const app = express();
const isProd = process.env.NODE_ENV === "production";
app.set("trust proxy", 1);

ensureSessionSecret(process.env);

const ENV_PATH = process.env.ENV_FILE || ".env";
const DB_PATH = process.env.DB_PATH || "./data/app.db";
const db = openDb(DB_PATH);
const LOCALES_DIR = path.join(__dirname, "locales");
const DEFAULT_LOCALE = process.env.DEFAULT_LOCALE || "de";
const translate = createTranslator({
  defaultLocale: DEFAULT_LOCALE,
  localesDir: LOCALES_DIR,
});
const redisUrl = process.env.REDIS_URL;
let redisClient = null;
let sessionStore = null;
if (redisUrl) {
  redisClient = createClient({ url: redisUrl });
  redisClient.on("error", (err) => {
    console.error("Redis-Verbindung fehlgeschlagen:", err);
  });
  redisClient
    .connect()
    .catch((err) => console.error("Redis-Connect fehlgeschlagen:", err));
  sessionStore = new RedisStore({
    client: redisClient,
    prefix: "mail-sim:sess:",
  });
} else if (isProd) {
  console.warn(
    "REDIS_URL ist nicht gesetzt; Sessions laufen im MemoryStore (nicht fuer Produktion).",
  );
}

// Ensure schema additions exist (idempotent)
try {
  const schemaSql = fs.readFileSync(
    path.join(__dirname, "db", "schema.sql"),
    "utf-8",
  );
  db.exec(schemaSql);
} catch (e) {
  console.warn("Schema konnte nicht geladen werden:", e.message);
}

function ensureColumn(dbHandle, table, column, sqlType) {
  const cols = dbHandle.prepare(`PRAGMA table_info(${table})`).all();
  if (cols.some((c) => c.name === column)) return;
  dbHandle.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${sqlType}`);
}

function ensureUsersSchema(dbHandle) {
  const row = dbHandle
    .prepare(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='users'",
    )
    .get();
  const sql = row?.sql || "";
  const hasSchoolAdminRole = sql.includes("schooladmin");
  const hasSchoolId = sql.includes("school_id");
  const hasUniqueUsername = sql.includes("username TEXT NOT NULL UNIQUE");
  if (hasSchoolAdminRole && hasSchoolId && !hasUniqueUsername) return;

  try {
    dbHandle.exec("PRAGMA foreign_keys=OFF");
    dbHandle.exec("BEGIN");
    dbHandle.exec("ALTER TABLE users RENAME TO users_old");
    const oldCols = dbHandle
      .prepare("PRAGMA table_info(users_old)")
      .all()
      .map((c) => c.name);
    const hasOldSchoolId = oldCols.includes("school_id");
    dbHandle.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL,
        display_name TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('student','teacher','schooladmin','admin')) DEFAULT 'student',
        course_id INTEGER NULL,
        school_id INTEGER NULL,
        pw_hash TEXT NOT NULL,
        expires_at TEXT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE SET NULL,
        FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE SET NULL
      );
    `);
    dbHandle.exec(`
      INSERT INTO users(id, username, display_name, role, course_id, school_id, pw_hash, expires_at, created_at)
      SELECT id, username, display_name, role, course_id, ${hasOldSchoolId ? "school_id" : "NULL"}, pw_hash, expires_at, created_at
      FROM users_old;
    `);
    dbHandle.exec("DROP TABLE users_old");
    dbHandle.exec("COMMIT");
  } catch (e) {
    try {
      dbHandle.exec("ROLLBACK");
    } catch (_) {}
    console.warn("Users-Migration fehlgeschlagen:", e.message);
  } finally {
    dbHandle.exec("PRAGMA foreign_keys=ON");
  }
}

function ensureCoursesSchema(dbHandle) {
  const row = dbHandle
    .prepare(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='courses'",
    )
    .get();
  const sql = row?.sql || "";
  const hasUniqueName = sql.includes("name TEXT NOT NULL UNIQUE");
  if (!hasUniqueName) return;

  try {
    dbHandle.exec("PRAGMA foreign_keys=OFF");
    dbHandle.exec("BEGIN");
    dbHandle.exec("ALTER TABLE courses RENAME TO courses_old");
    dbHandle.exec(`
      CREATE TABLE courses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        school_id INTEGER NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE SET NULL
      );
    `);
    dbHandle.exec(`
      INSERT INTO courses(id, name, school_id, created_at)
      SELECT id, name, school_id, created_at
      FROM courses_old;
    `);
    dbHandle.exec("DROP TABLE courses_old");
    dbHandle.exec("COMMIT");
  } catch (e) {
    try {
      dbHandle.exec("ROLLBACK");
    } catch (_) {}
    console.warn("Courses-Migration fehlgeschlagen:", e.message);
  } finally {
    dbHandle.exec("PRAGMA foreign_keys=ON");
  }
}

function ensureLegacyForeignKeys(dbHandle) {
  const usersSql =
    dbHandle
      .prepare(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='users'",
      )
      .get()?.sql || "";
  const teacherCoursesSql =
    dbHandle
      .prepare(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='teacher_courses'",
      )
      .get()?.sql || "";
  const sendWindowsSql =
    dbHandle
      .prepare(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='course_send_windows'",
      )
      .get()?.sql || "";
  const messagesSql =
    dbHandle
      .prepare(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='messages'",
      )
      .get()?.sql || "";
  const recipientsSql =
    dbHandle
      .prepare(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='recipients'",
      )
      .get()?.sql || "";
  const deliveriesSql =
    dbHandle
      .prepare(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='deliveries'",
      )
      .get()?.sql || "";
  const mailLogsSql =
    dbHandle
      .prepare(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='mail_logs'",
      )
      .get()?.sql || "";
  const mailLogRecipientsSql =
    dbHandle
      .prepare(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='mail_log_recipients'",
      )
      .get()?.sql || "";

  const needsUsersFix = /courses_old|users_old/i.test(usersSql);
  const needsTeacherCoursesFix = /courses_old|users_old/i.test(
    teacherCoursesSql,
  );
  const needsSendWindowsFix = /courses_old/i.test(sendWindowsSql);
  const needsMessagesFix = /users_old/i.test(messagesSql);
  const needsRecipientsFix = /users_old/i.test(recipientsSql);
  const needsDeliveriesFix = /users_old/i.test(deliveriesSql);
  const needsMailLogsFix = /users_old/i.test(mailLogsSql);
  const needsMailLogRecipientsFix = /users_old/i.test(mailLogRecipientsSql);
  if (
    !needsUsersFix &&
    !needsTeacherCoursesFix &&
    !needsSendWindowsFix &&
    !needsMessagesFix &&
    !needsRecipientsFix &&
    !needsDeliveriesFix &&
    !needsMailLogsFix &&
    !needsMailLogRecipientsFix
  )
    return;

  try {
    dbHandle.exec("PRAGMA foreign_keys=OFF");
    dbHandle.exec("BEGIN");

    if (needsUsersFix) {
      dbHandle.exec("DROP TABLE IF EXISTS users_old_fk");
      dbHandle.exec("ALTER TABLE users RENAME TO users_old_fk");
      dbHandle.exec(`
        CREATE TABLE users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT NOT NULL,
          display_name TEXT NOT NULL,
          role TEXT NOT NULL CHECK(role IN ('student','teacher','schooladmin','admin')) DEFAULT 'student',
          course_id INTEGER NULL,
          school_id INTEGER NULL,
          pw_hash TEXT NOT NULL,
          expires_at TEXT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE SET NULL,
          FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE SET NULL
        );
      `);
      dbHandle.exec(`
        INSERT INTO users(id, username, display_name, role, course_id, school_id, pw_hash, expires_at, created_at)
        SELECT id, username, display_name, role, course_id, school_id, pw_hash, expires_at, created_at
        FROM users_old_fk;
      `);
      dbHandle.exec("DROP TABLE users_old_fk");
    }

    if (needsTeacherCoursesFix) {
      dbHandle.exec("DROP TABLE IF EXISTS teacher_courses_old_fk");
      dbHandle.exec(
        "ALTER TABLE teacher_courses RENAME TO teacher_courses_old_fk",
      );
      dbHandle.exec(`
        CREATE TABLE teacher_courses (
          user_id INTEGER NOT NULL,
          course_id INTEGER NOT NULL,
          PRIMARY KEY (user_id, course_id),
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
        );
      `);
      dbHandle.exec(`
        INSERT INTO teacher_courses(user_id, course_id)
        SELECT user_id, course_id
        FROM teacher_courses_old_fk;
      `);
      dbHandle.exec("DROP TABLE teacher_courses_old_fk");
      dbHandle.exec(
        "CREATE INDEX IF NOT EXISTS idx_teacher_courses_user ON teacher_courses(user_id)",
      );
      dbHandle.exec(
        "CREATE INDEX IF NOT EXISTS idx_teacher_courses_course ON teacher_courses(course_id)",
      );
    }

    if (needsSendWindowsFix) {
      const sendWindowCols = dbHandle
        .prepare("PRAGMA table_info(course_send_windows)")
        .all()
        .map((c) => c.name);
      const hasAttachmentsEnabled = sendWindowCols.includes(
        "attachments_enabled",
      );
      dbHandle.exec("DROP TABLE IF EXISTS course_send_windows_old_fk");
      dbHandle.exec(
        "ALTER TABLE course_send_windows RENAME TO course_send_windows_old_fk",
      );
      dbHandle.exec(`
        CREATE TABLE course_send_windows (
          course_id INTEGER PRIMARY KEY,
          open_until TEXT NULL,
          attachments_enabled INTEGER NOT NULL DEFAULT 0,
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
        );
      `);
      dbHandle.exec(`
        INSERT INTO course_send_windows(course_id, open_until, attachments_enabled, updated_at)
        SELECT course_id, open_until, ${hasAttachmentsEnabled ? "attachments_enabled" : "0"}, updated_at
        FROM course_send_windows_old_fk;
      `);
      dbHandle.exec("DROP TABLE course_send_windows_old_fk");
    }

    if (needsMessagesFix) {
      dbHandle.exec("DROP TABLE IF EXISTS messages_old_fk");
      dbHandle.exec("ALTER TABLE messages RENAME TO messages_old_fk");
      dbHandle.exec(`
        CREATE TABLE messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          sender_id INTEGER NOT NULL,
          subject TEXT NOT NULL,
          body_html TEXT NOT NULL,
          body_text TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          thread_id INTEGER NOT NULL,
          parent_message_id INTEGER NULL,
          is_draft INTEGER NOT NULL DEFAULT 0,
          FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE,
          FOREIGN KEY (parent_message_id) REFERENCES messages(id) ON DELETE SET NULL
        );
      `);
      dbHandle.exec(`
        INSERT INTO messages(id, sender_id, subject, body_html, body_text, created_at, thread_id, parent_message_id, is_draft)
        SELECT id, sender_id, subject, body_html, body_text, created_at, thread_id, parent_message_id, is_draft
        FROM messages_old_fk;
      `);
      dbHandle.exec("DROP TABLE messages_old_fk");
    }

    if (needsRecipientsFix) {
      dbHandle.exec("DROP TABLE IF EXISTS recipients_old_fk");
      dbHandle.exec("ALTER TABLE recipients RENAME TO recipients_old_fk");
      dbHandle.exec(`
        CREATE TABLE recipients (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          message_id INTEGER NOT NULL,
          user_id INTEGER NOT NULL,
          type TEXT NOT NULL CHECK(type IN ('TO','CC','BCC')),
          FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
      `);
      dbHandle.exec(`
        INSERT INTO recipients(id, message_id, user_id, type)
        SELECT id, message_id, user_id, type
        FROM recipients_old_fk;
      `);
      dbHandle.exec("DROP TABLE recipients_old_fk");
      dbHandle.exec(
        "CREATE INDEX IF NOT EXISTS idx_recipients_msg ON recipients(message_id)",
      );
    }

    if (needsDeliveriesFix) {
      dbHandle.exec("DROP TABLE IF EXISTS deliveries_old_fk");
      dbHandle.exec("ALTER TABLE deliveries RENAME TO deliveries_old_fk");
      dbHandle.exec(`
        CREATE TABLE deliveries (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          message_id INTEGER NOT NULL,
          owner_user_id INTEGER NOT NULL,
          folder TEXT NOT NULL CHECK(folder IN ('INBOX','SENT','DRAFTS','TRASH')),
          is_read INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          deleted_at TEXT NULL,
          FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
          FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
        );
      `);
      dbHandle.exec(`
        INSERT INTO deliveries(id, message_id, owner_user_id, folder, is_read, created_at, deleted_at)
        SELECT id, message_id, owner_user_id, folder, is_read, created_at, deleted_at
        FROM deliveries_old_fk;
      `);
      dbHandle.exec("DROP TABLE deliveries_old_fk");
      dbHandle.exec(
        "CREATE INDEX IF NOT EXISTS idx_deliveries_owner_folder_created ON deliveries(owner_user_id, folder, created_at)",
      );
    }

    if (needsMailLogsFix) {
      dbHandle.exec("DROP TABLE IF EXISTS mail_logs_old_fk");
      dbHandle.exec("ALTER TABLE mail_logs RENAME TO mail_logs_old_fk");
      dbHandle.exec(`
        CREATE TABLE mail_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          message_id INTEGER NOT NULL,
          sender_id INTEGER NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
          FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE
        );
      `);
      dbHandle.exec(`
        INSERT INTO mail_logs(id, message_id, sender_id, created_at)
        SELECT id, message_id, sender_id, created_at
        FROM mail_logs_old_fk;
      `);
      dbHandle.exec("DROP TABLE mail_logs_old_fk");
      dbHandle.exec(
        "CREATE INDEX IF NOT EXISTS idx_mail_logs_sender_created ON mail_logs(sender_id, created_at)",
      );
    }

    if (needsMailLogRecipientsFix) {
      dbHandle.exec("DROP TABLE IF EXISTS mail_log_recipients_old_fk");
      dbHandle.exec(
        "ALTER TABLE mail_log_recipients RENAME TO mail_log_recipients_old_fk",
      );
      dbHandle.exec(`
        CREATE TABLE mail_log_recipients (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          log_id INTEGER NOT NULL,
          user_id INTEGER NOT NULL,
          type TEXT NOT NULL CHECK(type IN ('TO','CC','BCC')),
          FOREIGN KEY (log_id) REFERENCES mail_logs(id) ON DELETE CASCADE,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
      `);
      dbHandle.exec(`
        INSERT INTO mail_log_recipients(id, log_id, user_id, type)
        SELECT id, log_id, user_id, type
        FROM mail_log_recipients_old_fk;
      `);
      dbHandle.exec("DROP TABLE mail_log_recipients_old_fk");
      dbHandle.exec(
        "CREATE INDEX IF NOT EXISTS idx_mail_log_rec_log ON mail_log_recipients(log_id)",
      );
    }

    dbHandle.exec("COMMIT");
  } catch (e) {
    try {
      dbHandle.exec("ROLLBACK");
    } catch (_) {}
    console.warn("FK-Reparatur fehlgeschlagen:", e.message);
  } finally {
    dbHandle.exec("PRAGMA foreign_keys=ON");
  }
}

function ensureUserIndexes(dbHandle) {
  dbHandle.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS uniq_courses_school_name ON courses(school_id, name);
    CREATE UNIQUE INDEX IF NOT EXISTS uniq_students_username_course ON users(username, course_id) WHERE role='student';
    CREATE UNIQUE INDEX IF NOT EXISTS uniq_teachers_username_school ON users(username, school_id) WHERE role='teacher';
    CREATE UNIQUE INDEX IF NOT EXISTS uniq_schooladmins_username_school ON users(username, school_id) WHERE role='schooladmin';
    CREATE UNIQUE INDEX IF NOT EXISTS uniq_admins_username ON users(username) WHERE role='admin';
  `);
}

function ensureTeacherSchoolId(dbHandle) {
  dbHandle.exec(`
    UPDATE users
    SET school_id = (
      SELECT c.school_id
      FROM teacher_courses tc
      JOIN courses c ON c.id=tc.course_id
      WHERE tc.user_id=users.id
      LIMIT 1
    )
    WHERE role='teacher' AND school_id IS NULL;
  `);
}

function ensureDefaultSchool(dbHandle) {
  const count =
    dbHandle.prepare("SELECT COUNT(*) AS count FROM schools").get()?.count || 0;
  if (!count) {
    dbHandle
      .prepare("INSERT INTO schools(name, domain) VALUES (?, ?)")
      .run("default", "local.test");
  }
  const defaultSchoolId = dbHandle
    .prepare("SELECT id FROM schools WHERE name=?")
    .get("default")?.id;
  if (defaultSchoolId) {
    dbHandle
      .prepare("UPDATE courses SET school_id=? WHERE school_id IS NULL")
      .run(defaultSchoolId);
  }
}

function ensureTeacherCourses(dbHandle) {
  const exists = dbHandle
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='teacher_courses'",
    )
    .get();
  if (!exists) return;
  const count =
    dbHandle.prepare("SELECT COUNT(*) AS count FROM teacher_courses").get()
      ?.count || 0;
  if (count) return;

  const rows = dbHandle
    .prepare(
      `
    SELECT id, course_id
    FROM users
    WHERE role='teacher' AND course_id IS NOT NULL
  `,
    )
    .all();

  if (!rows.length) return;
  const ins = dbHandle.prepare(
    "INSERT OR IGNORE INTO teacher_courses(user_id, course_id) VALUES (?, ?)",
  );
  const tx = dbHandle.transaction(() => {
    for (const row of rows) ins.run(row.id, row.course_id);
  });
  tx();
}

try {
  ensureColumn(db, "courses", "school_id", "INTEGER NULL");
  ensureColumn(db, "users", "school_id", "INTEGER NULL");
  ensureColumn(
    db,
    "course_send_windows",
    "attachments_enabled",
    "INTEGER NOT NULL DEFAULT 0",
  );
  ensureUsersSchema(db);
  ensureCoursesSchema(db);
  ensureLegacyForeignKeys(db);
  ensureDefaultSchool(db);
  ensureTeacherCourses(db);
  ensureTeacherSchoolId(db);
  ensureUserIndexes(db);
} catch (e) {
  console.warn("Schema-Update fehlgeschlagen:", e.message);
}

// ---------- Hardening ----------
app.use(
  helmet({
    contentSecurityPolicy: false, // keep simple for Quill CDN; tighten if you self-host assets
  }),
);
app.use(rateLimit({ windowMs: 60_000, max: 300 }));

// ---------- View engine ----------
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use((req, res, next) => {
  res.locals.assetVersion = process.env.ASSET_VERSION || "v0";
  next();
});

// ---------- Parsers ----------
app.use(express.urlencoded({ extended: true, limit: "1mb" }));
app.use(express.json({ limit: "1mb" }));

// ---------- Session ----------
app.use(
  session({
    secret: process.env.SESSION_SECRET || "dev-secret-change-me",
    resave: false,
    saveUninitialized: false,
    rolling: true,
    store: sessionStore || undefined,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: isProd,
      maxAge: 1000 * 60 * 60 * 24 * 7,
    },
  }),
);

// ---------- i18n ----------
app.use((req, res, next) => {
  const locale = req.session?.locale || DEFAULT_LOCALE;
  res.locals.locale = locale;
  res.locals.t = (key, vars) => translate(locale, key, vars);
  req.t = res.locals.t;
  next();
});

// ---------- Inject user for templates ----------
app.use((req, res, next) => {
  if (req.session?.userId) {
    const user = db
      .prepare(
        `
      SELECT u.id, u.username, u.display_name, u.role, u.course_id, u.school_id, u.expires_at,
             c.name AS course_name,
             COALESCE(sc.domain, us.domain) AS school_domain
      FROM users u
      LEFT JOIN courses c ON c.id=u.course_id
      LEFT JOIN schools sc ON sc.id=c.school_id
      LEFT JOIN schools us ON us.id=u.school_id
      WHERE u.id=?
    `,
      )
      .get(req.session.userId);

    // expired -> force logout
    if (user?.expires_at) {
      const now = new Date();
      const exp = new Date(user.expires_at + "T23:59:59");
      if (now > exp) {
        req.session.destroy(() => res.redirect("/login"));
        return;
      }
    }

    const sendWindowOpen = user
      ? user.role === "admin"
        ? true
        : isSendWindowOpen(db, user.course_id)
      : false;
    const attachmentsEnabled = user
      ? user.role === "admin"
        ? true
        : isAttachmentsEnabled(db, user.course_id)
      : false;
    const attachmentsAllowed =
      user?.role === "student" ? sendWindowOpen && attachmentsEnabled : !!user;

    res.locals.me = user
      ? {
          ...user,
          send_window_open: sendWindowOpen,
          attachments_enabled: attachmentsEnabled,
          attachments_allowed: attachmentsAllowed,
          email: formatLogin(
            {
              username: user.username,
              courseName: user.course_name,
              domain: user.school_domain,
              role: user.role,
            },
            process.env,
          ),
        }
      : null;
  } else {
    res.locals.me = null;
  }
  next();
});

// ---------- Setup guard ----------
app.use((req, res, next) => {
  if (!needsSetup(process.env) && isDatabaseReady(db)) return next();
  if (req.path.startsWith("/setup") || req.path.startsWith("/assets")) {
    return next();
  }
  return res.redirect("/setup");
});

// ---------- Static assets ----------
app.use("/assets", express.static(path.join(__dirname, "public", "assets")));

// ---------- Routes ----------
app.use(createSetupRouter({ db, envPath: ENV_PATH }));
app.use(createAuthRouter({ db }));
app.use(createMailRouter({ db }));
app.use(createTeacherRouter({ db }));
app.use(createAdminRouter({ db }));
app.use(createSchoolAdminRouter({ db }));

module.exports = { app, db };
