const path = require("path");
const { spawn } = require("child_process");
const fs = require("fs");

const buildDir = path.join(process.cwd(), "build");
const serverEntry = path.join(buildDir, "src", "server.js");

if (!fs.existsSync(serverEntry)) {
  console.error("Build nicht gefunden. Bitte zuerst `npm run build` ausfuehren.");
  process.exit(1);
}

const env = { ...process.env };
env.SOCKET_PATH = "";
env.SOCKET_MODE = "";
env.REDIS_URL = "";
env.FORCE_SETUP = "1";
env.PORT = env.PORT || "3000";
env.NODE_ENV = env.NODE_ENV || "production";
env.ENV_FILE = env.ENV_FILE || path.join(buildDir, ".env");

const child = spawn(process.execPath, [serverEntry], {
  cwd: buildDir,
  stdio: "inherit",
  env,
});

child.on("exit", (code) => process.exit(code ?? 0));
