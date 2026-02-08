const fs = require("fs");
const path = require("path");

const examplePath = path.join(process.cwd(), ".env.example");
const buildDir = path.join(process.cwd(), "build");
const includeNodeModules = process.env.INCLUDE_NODE_MODULES === "1";

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function copyFile(src, dest) {
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
}

function copyDir(src, dest, { ignore = [], ignorePatterns = [] } = {}) {
  const ignores = new Set(ignore);
  const entries = fs.readdirSync(src, { withFileTypes: true });
  ensureDir(dest);

  for (const entry of entries) {
    if (ignores.has(entry.name)) continue;
    if (ignorePatterns.some((pattern) => pattern.test(entry.name))) continue;
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath, { ignore, ignorePatterns });
    } else if (entry.isFile()) {
      copyFile(srcPath, destPath);
    }
  }
}

function resetBuildDir() {
  if (fs.existsSync(buildDir)) {
    fs.rmSync(buildDir, { recursive: true, force: true });
  }
  ensureDir(buildDir);
  const staleEnv = path.join(buildDir, ".env");
  if (fs.existsSync(staleEnv)) {
    fs.rmSync(staleEnv, { force: true });
  }
  const staleDataDir = path.join(buildDir, "data");
  if (fs.existsSync(staleDataDir)) {
    const entries = fs.readdirSync(staleDataDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (/\.db$/i.test(entry.name)) {
        fs.rmSync(path.join(staleDataDir, entry.name), { force: true });
      }
    }
  }
}

function buildBundle() {
  resetBuildDir();

  const rootFiles = [
    "package.json",
    "package-lock.json",
    "README.md",
    "LICENSE",
  ];

  for (const file of rootFiles) {
    const src = path.join(process.cwd(), file);
    if (fs.existsSync(src)) {
      copyFile(src, path.join(buildDir, file));
    }
  }

  const srcDir = path.join(process.cwd(), "src");
  if (fs.existsSync(srcDir)) {
    copyDir(srcDir, path.join(buildDir, "src"));
  }

  const dataDir = path.join(process.cwd(), "data");
  const buildDataDir = path.join(buildDir, "data");
  ensureDir(buildDataDir);
  if (fs.existsSync(dataDir)) {
    copyDir(dataDir, buildDataDir, {
      ignorePatterns: [/\.db$/i],
    });
  }

  if (includeNodeModules) {
    const nodeModulesDir = path.join(process.cwd(), "node_modules");
    if (fs.existsSync(nodeModulesDir)) {
      copyDir(nodeModulesDir, path.join(buildDir, "node_modules"), {
        ignore: [".cache"],
      });
    }
  }

  console.log(`Build erstellt unter: ${buildDir}`);
  if (!includeNodeModules) {
    console.log("Hinweis: node_modules wurde nicht kopiert.");
  }
  console.log(
    "Hinweis: .env und vorhandene .db-Dateien werden nicht in den Build übernommen.",
  );
}

buildBundle();
