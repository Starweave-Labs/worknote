#!/usr/bin/env node
/** Initialize private storage without changing existing work records. Requires npm run build. */
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const options = {};
for (let i = 0; i < args.length; i++) {
  const key = args[i];
  if (key === "--help" || key === "-h") {
    console.log("Usage: npm run init -- [--data-dir /private/path] [--project example --name 示例项目 --system 工作记录] [--no-env]");
    process.exit(0);
  }
  if (key === "--no-env") { options.noEnv = true; continue; }
  if (!["--data-dir", "--project", "--name", "--system"].includes(key) || !args[i + 1] || args[i + 1].startsWith("--")) {
    console.error(`Unknown option or missing value: ${key}`);
    process.exit(1);
  }
  options[key.slice(2)] = args[++i];
}
if (options["data-dir"]) process.env.WORKNOTE_ROOT = resolve(options["data-dir"]);
if (options.noEnv) process.env.WORKNOTE_ENV_FILE = "";
if ((options.project && !options.name) || (!options.project && (options.name || options.system))) {
  console.error("--project and --name must be supplied together; --system requires a project.");
  process.exit(1);
}

try {
  if (!existsSync(resolve(repo, "server/dist/projects.js"))) {
    throw new Error("Run npm run build before initialization.");
  }
  const { dataRoot, sourceRoot } = await import("../server/dist/environment.js");
  const { readProjectConfig, validateProjectConfig } = await import("../server/dist/projects.js");
  const root = dataRoot();
  if (root === sourceRoot) throw new Error("Choose a separate private data directory, such as data/.");
  const existingProjects = readProjectConfig(root);
  let projects = existingProjects;
  if (options.project) {
    const candidate = { slug: options.project, name: options.name, ...(options.system ? { system: options.system } : {}) };
    validateProjectConfig([candidate]);
    const found = existingProjects.find((item) => item.slug === candidate.slug);
    if (found && (found.name !== candidate.name || (options.system && found.system !== candidate.system))) {
      throw new Error("This project already exists with different metadata. Edit private projects.json explicitly to change it.");
    }
    if (!found) projects = validateProjectConfig([...existingProjects, candidate]);
  }
  const ensureDirectory = (path) => {
    if (existsSync(path) && lstatSync(path).isSymbolicLink()) throw new Error(`Refusing symbolic link: ${path}`);
    mkdirSync(path, { recursive: true, mode: 0o755 });
  };
  const ensureFile = (path, text, mode = 0o644) => {
    if (existsSync(path)) return false;
    writeFileSync(path, text, { flag: "wx", mode });
    return true;
  };
  ensureDirectory(root);
  ensureDirectory(resolve(root, "projects"));
  ensureDirectory(resolve(root, "inbox/attachments"));
  for (const project of projects) ensureDirectory(resolve(root, "projects", project.slug, "daily"));
  const projectFile = resolve(root, "projects.json");
  if (!existsSync(projectFile) || projects.length !== existingProjects.length) {
    if (existsSync(projectFile) && lstatSync(projectFile).isSymbolicLink()) throw new Error("Refusing projects.json symbolic link.");
    const temp = `${projectFile}.${process.pid}.tmp`;
    writeFileSync(temp, JSON.stringify(projects, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    renameSync(temp, projectFile);
    chmodSync(projectFile, 0o600);
  }
  ensureFile(resolve(root, "todo.md"), "# 待办清单\n\n## 未完成\n\n## 已完成\n");
  ensureFile(resolve(root, "index.md"), "# 工作记录索引\n");
  ensureFile(resolve(root, "inbox.md"), "# 收件箱\n");
  const ignored = "# Keep this data repository private; exclude credentials and caches.\n/site-config.json\n/ai-config.json\n/shares.json\n/.env\n/.cache/\n*.tmp\n*.log\n";
  ensureFile(resolve(root, ".gitignore"), ignored);
  console.log(`Private data initialized: ${root}`);
  console.log(`Projects: ${projects.map((item) => item.slug).join(", ") || "none; add one with --project <slug> --name <name>"}`);

  if (!options.noEnv) {
    const envFile = process.env.WORKNOTE_ENV_FILE ? resolve(process.env.WORKNOTE_ENV_FILE) : resolve(repo, ".env");
    if (existsSync(envFile) && lstatSync(envFile).isSymbolicLink()) throw new Error("Refusing environment file symbolic link.");
    const generated = {};
    if (!process.env.WORKNOTE_PASSWORD) generated.WORKNOTE_PASSWORD = randomBytes(18).toString("base64url");
    if (!process.env.WORKNOTE_SECRET) generated.WORKNOTE_SECRET = randomBytes(32).toString("hex");
    const additions = { WORKNOTE_ROOT: root, ...generated };
    let text = existsSync(envFile) ? readFileSync(envFile, "utf8") : "# Local private configuration. Never commit this file.\n";
    for (const [key, value] of Object.entries(additions)) {
      const line = `${key}=${JSON.stringify(value)}`;
      const re = new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=.*$`, "gm");
      if (re.test(text)) text = text.replace(re, () => line);
      else text += `${text.endsWith("\n") ? "" : "\n"}${line}\n`;
    }
    if (!/^\s*WORKNOTE_SECURE_COOKIE\s*=/m.test(text)) text += "WORKNOTE_SECURE_COOKIE=true\n";
    const temp = `${envFile}.${process.pid}.tmp`;
    writeFileSync(temp, text, { flag: "wx", mode: 0o600 });
    renameSync(temp, envFile);
    chmodSync(envFile, 0o600);
    console.log(`Local environment saved with mode 600: ${envFile}`);
    if (generated.WORKNOTE_PASSWORD) console.log(`Generated login password: ${generated.WORKNOTE_PASSWORD}`);
    console.log("Use HTTPS for deployment. For local HTTP only, set WORKNOTE_SECURE_COOKIE=false in .env.");
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
