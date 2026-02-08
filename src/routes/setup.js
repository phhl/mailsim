const express = require("express");
const bcrypt = require("bcryptjs");
const path = require("path");

const {
  getSetupDefaults,
  upsertEnvFile,
  needsSetup,
  isDatabaseReady,
  isMissing,
  DEFAULTS,
} = require("../utils/setup");

module.exports = function createSetupRouter({ db, envPath }) {
  const router = express.Router();
  const resolvedEnvPath = envPath || path.join(process.cwd(), ".env");

  function parseFlag(value, fallback) {
    if (value === "1" || value === 1 || value === true) return "1";
    if (value === "0" || value === 0 || value === false) return "0";
    return fallback;
  }

  function parsePositiveInt(value, fallback) {
    const num = Number(value);
    if (!Number.isFinite(num) || num <= 0) return fallback;
    return Math.floor(num);
  }

  function ensureDefaultSchoolCourse() {
    let school = db
      .prepare("SELECT id FROM schools WHERE name=?")
      .get("default");
    if (!school) {
      const insert = db.prepare(
        "INSERT INTO schools(name, domain) VALUES (?, ?)",
      );
      insert.run("default", "local.test");
      school = db
        .prepare("SELECT id FROM schools WHERE name=?")
        .get("default");
    }

    let course = db
      .prepare("SELECT id FROM courses WHERE name=? AND school_id=?")
      .get("default", school.id);
    if (!course) {
      db.prepare("INSERT INTO courses(name, school_id) VALUES (?, ?)")
        .run("default", school.id);
      course = db
        .prepare("SELECT id FROM courses WHERE name=? AND school_id=?")
        .get("default", school.id);
    }

    return { schoolId: school.id, courseId: course.id };
  }

  function ensureAdminUser(username, password) {
    const existing = db
      .prepare("SELECT id FROM users WHERE role='admin' LIMIT 1")
      .get();
    if (existing) {
      db.prepare("UPDATE users SET course_id=NULL, school_id=NULL WHERE role='admin'").run();
      return false;
    }
    const hash = bcrypt.hashSync(password, 12);
    db.prepare(
      "INSERT INTO users(username, display_name, role, course_id, school_id, pw_hash) VALUES (?,?,?,?,?,?)",
    ).run(username, "Administrator", "admin", null, null, hash);
    return true;
  }

  router.get("/setup", (req, res) => {
    if (!needsSetup(process.env) && isDatabaseReady(db)) {
      return res.redirect("/");
    }

    const defaults = getSetupDefaults(process.env);
    const setupResult = req.session?.setupResult || null;
    if (req.session?.setupResult) delete req.session.setupResult;

    return res.render("setup", {
      defaults,
      error: null,
      success: setupResult?.success || null,
      restartNotice: setupResult?.restartNotice || null,
      needsSetup: needsSetup(process.env) || !isDatabaseReady(db),
    });
  });

  router.post("/setup", (req, res) => {
    if (!needsSetup(process.env) && isDatabaseReady(db)) {
      return res.redirect("/");
    }

    const body = req.body || {};
    const defaults = getSetupDefaults(process.env);

    const sessionSecret = (body.session_secret || "").toString().trim();
    const adminUser = (body.default_admin_user || "").toString().trim();
    const adminPass = (body.default_admin_pass || "").toString().trim();
    const teacherCanSeeBcc = parseFlag(
      body.teacher_can_see_bcc,
      defaults.teacher_can_see_bcc,
    );
    const teacherCanCreate = parseFlag(
      body.teacher_can_create,
      defaults.teacher_can_create,
    );
    const sendWindowRaw = body.send_window_minutes;
    const sendWindowMinutes = Number(sendWindowRaw);

    if (isMissing(sessionSecret)) {
      return res.status(400).render("setup", {
        defaults: { ...defaults, ...body, session_secret: "" },
        error: req.t("setup.errors.session_secret"),
        success: null,
        restartNotice: null,
        needsSetup: true,
      });
    }
    if (isMissing(adminUser) || isMissing(adminPass)) {
      return res.status(400).render("setup", {
        defaults: {
          ...defaults,
          ...body,
          session_secret: sessionSecret,
          default_admin_user: adminUser,
          default_admin_pass: adminPass,
        },
        error: req.t("setup.errors.admin"),
        success: null,
        restartNotice: null,
        needsSetup: true,
      });
    }
    if (!Number.isFinite(sendWindowMinutes) || sendWindowMinutes <= 0) {
      return res.status(400).render("setup", {
        defaults: {
          ...defaults,
          ...body,
          session_secret: sessionSecret,
          default_admin_user: adminUser,
          default_admin_pass: adminPass,
          send_window_minutes: sendWindowRaw,
        },
        error: req.t("setup.errors.send_window"),
        success: null,
        restartNotice: null,
        needsSetup: true,
      });
    }

    const updates = {
      SESSION_SECRET: sessionSecret,
      DEFAULT_ADMIN_USER: adminUser,
      DEFAULT_ADMIN_PASS: adminPass,
      TEACHER_CAN_SEE_BCC: teacherCanSeeBcc,
      TEACHER_CAN_CREATE: teacherCanCreate,
      SEND_WINDOW_MINUTES: String(
        Math.max(1, Math.min(sendWindowMinutes, 240)),
      ),
      TEACHER_AUTO_CREATE_MAX: String(
        parsePositiveInt(
          body.auto_create_max,
          Number(DEFAULTS.TEACHER_AUTO_CREATE_MAX),
        ),
      ),
      TEACHER_NAME_API_URL: (body.name_api_url || "").toString().trim(),
      TEACHER_NAME_API_NAT: (body.name_api_nat || "").toString().trim(),
      TEACHER_NAME_API_TIMEOUT_MS: String(
        parsePositiveInt(
          body.name_api_timeout_ms,
          Number(DEFAULTS.TEACHER_NAME_API_TIMEOUT_MS),
        ),
      ),
    };

    upsertEnvFile(resolvedEnvPath, updates);
    Object.assign(process.env, updates);
    if (process.env.SESSION_SECRET_AUTO) {
      delete process.env.SESSION_SECRET_AUTO;
    }

    ensureDefaultSchoolCourse();
    const adminCreated = ensureAdminUser(adminUser, adminPass);
    const restartNotice =
      sessionSecret !== defaults.session_secret
        ? req.t("setup.restart_notice")
        : null;

    req.session.setupResult = {
      success: adminCreated
        ? req.t("setup.success_created")
        : req.t("setup.success_saved"),
      restartNotice,
    };
    return res.redirect("/setup");
  });

  return router;
};
