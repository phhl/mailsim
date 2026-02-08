const path = require("path");
const { spawn } = require("child_process");

const serverEntry = path.join(process.cwd(), "src", "server.js");

const env = { ...process.env };
env.SOCKET_PATH = "";
env.SOCKET_MODE = "";
env.REDIS_URL = "";
env.PORT = env.PORT || "3000";
env.NODE_ENV = env.NODE_ENV || "development";
env.ENV_FILE = env.ENV_FILE || path.join(process.cwd(), ".env");

const child = spawn(process.execPath, [serverEntry], {
  cwd: process.cwd(),
  stdio: "inherit",
  env,
});

child.on("exit", (code) => process.exit(code ?? 0));
