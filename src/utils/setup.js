const crypto = require("crypto");
const fs = require("fs");

const REQUIRED_KEYS = [
  "SESSION_SECRET",
  "DEFAULT_ADMIN_USER",
  "DEFAULT_ADMIN_PASS",
  "TEACHER_CAN_SEE_BCC",
  "TEACHER_CAN_CREATE",
  "SEND_WINDOW_MINUTES",
];

const DEFAULTS = {
  DEFAULT_ADMIN_USER: "admin",
  DEFAULT_ADMIN_PASS: "admin123!",
  TEACHER_CAN_SEE_BCC: "1",
  TEACHER_CAN_CREATE: "1",
  SEND_WINDOW_MINUTES: "45",
  TEACHER_AUTO_CREATE_MAX: "60",
  TEACHER_NAME_API_URL: "https://randomuser.me/api/",
  TEACHER_NAME_API_NAT: "de",
  TEACHER_NAME_API_TIMEOUT_MS: "3500",
};

function isMissing(value) {
  return value === undefined || value === null || String(value).trim() === "";
}

function ensureSessionSecret(env) {
  if (!isMissing(env.SESSION_SECRET)) return false;
  env.SESSION_SECRET = crypto.randomBytes(32).toString("hex");
  env.SESSION_SECRET_AUTO = "1";
  return true;
}

function isDatabaseReady(db) {
  if (!db) return false;
  try {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((row) => row.name);
    const tableSet = new Set(tables);
    const hasCoreTables =
      tableSet.has("users") && tableSet.has("schools") && tableSet.has("courses");
    if (!hasCoreTables) return false;

    const admin = db
      .prepare("SELECT id FROM users WHERE role='admin' LIMIT 1")
      .get();
    if (!admin) return false;

    return true;
  } catch (err) {
    return false;
  }
}

function needsSetup(env) {
  if (env.FORCE_SETUP === "1") return true;
  if (env.SESSION_SECRET_AUTO === "1") return true;
  return REQUIRED_KEYS.some((key) => isMissing(env[key]));
}

function getSetupDefaults(env) {
  return {
    session_secret: env.SESSION_SECRET || "",
    default_admin_user: env.DEFAULT_ADMIN_USER || DEFAULTS.DEFAULT_ADMIN_USER,
    default_admin_pass: env.DEFAULT_ADMIN_PASS || DEFAULTS.DEFAULT_ADMIN_PASS,
    teacher_can_see_bcc:
      env.TEACHER_CAN_SEE_BCC || DEFAULTS.TEACHER_CAN_SEE_BCC,
    teacher_can_create:
      env.TEACHER_CAN_CREATE || DEFAULTS.TEACHER_CAN_CREATE,
    send_window_minutes:
      env.SEND_WINDOW_MINUTES || DEFAULTS.SEND_WINDOW_MINUTES,
    auto_create_max:
      env.TEACHER_AUTO_CREATE_MAX || DEFAULTS.TEACHER_AUTO_CREATE_MAX,
    name_api_url: env.TEACHER_NAME_API_URL || DEFAULTS.TEACHER_NAME_API_URL,
    name_api_nat: env.TEACHER_NAME_API_NAT || DEFAULTS.TEACHER_NAME_API_NAT,
    name_api_timeout_ms:
      env.TEACHER_NAME_API_TIMEOUT_MS || DEFAULTS.TEACHER_NAME_API_TIMEOUT_MS,
  };
}

function formatEnvValue(value) {
  const raw = value === undefined || value === null ? "" : String(value);
  if (!raw) return "";
  if (/[\s#"'`]/.test(raw)) {
    return JSON.stringify(raw);
  }
  return raw;
}

function upsertEnvFile(filePath, updates) {
  const content = fs.existsSync(filePath)
    ? fs.readFileSync(filePath, "utf-8")
    : "";
  const lines = content.split(/\r?\n/);
  const remaining = new Set(Object.keys(updates));

  const updatedLines = lines.map((line) => {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=/);
    if (!match) return line;
    const key = match[1];
    if (!Object.prototype.hasOwnProperty.call(updates, key)) return line;
    remaining.delete(key);
    return `${key}=${formatEnvValue(updates[key])}`;
  });

  for (const key of remaining) {
    updatedLines.push(`${key}=${formatEnvValue(updates[key])}`);
  }

  const output = updatedLines.join("\n").replace(/\n+$/, "\n");
  fs.writeFileSync(filePath, output, "utf-8");
}

module.exports = {
  REQUIRED_KEYS,
  ensureSessionSecret,
  isDatabaseReady,
  needsSetup,
  getSetupDefaults,
  upsertEnvFile,
  isMissing,
  DEFAULTS,
};
