import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, statSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const script = fileURLToPath(new URL("../scripts/init.mjs", import.meta.url));
function run(root, args = []) {
  return spawnSync(process.execPath, [script, "--data-dir", root, "--no-env", ...args], {
    encoding: "utf8", env: { ...process.env, WORKNOTE_ENV_FILE: "", WORKNOTE_AI_KEY: "", WORKNOTE_NOTIFY_WEBHOOK: "" },
  });
}

test("initialize an empty private root, register a project, and preserve existing records", () => {
  const root = mkdtempSync(resolve(tmpdir(), "worknote-init-"));
  try {
    let result = run(root);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(readFileSync(resolve(root, "projects.json"), "utf8")), []);
    assert.ok(existsSync(resolve(root, "todo.md")));
    assert.equal(statSync(resolve(root, "projects.json")).mode & 0o777, 0o600);
    result = run(root, ["--project", "example", "--name", "示例项目", "--system", "演示系统"]);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(readFileSync(resolve(root, "projects.json"), "utf8")), [{ slug: "example", name: "示例项目", system: "演示系统" }]);
    writeFileSync(resolve(root, "todo.md"), "# existing private content\n");
    result = run(root, ["--project", "example", "--name", "示例项目", "--system", "演示系统"]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(resolve(root, "todo.md"), "utf8"), "# existing private content\n");
    assert.equal(run(root, ["--project", "../outside", "--name", "不合法项目"]).status, 1);
    assert.equal(run(root, ["--project", "example", "--name", "不同名称"]).status, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("initialization can generate credentials in an explicitly private env file", () => {
  const root = mkdtempSync(resolve(tmpdir(), "worknote-init-env-"));
  const envFile = resolve(root, "config.env");
  try {
    const result = spawnSync(process.execPath, [script, "--data-dir", resolve(root, "data")], {
      encoding: "utf8", env: { ...process.env, WORKNOTE_ENV_FILE: envFile, WORKNOTE_PASSWORD: "", WORKNOTE_SECRET: "" },
    });
    // Explicit files must exist before loading; initialize a blank config first.
    assert.equal(result.status, 1);
    writeFileSync(envFile, "", { mode: 0o600 });
    const initialized = spawnSync(process.execPath, [script, "--data-dir", resolve(root, "data")], {
      encoding: "utf8", env: { ...process.env, WORKNOTE_ENV_FILE: envFile, WORKNOTE_PASSWORD: "", WORKNOTE_SECRET: "" },
    });
    assert.equal(initialized.status, 0, initialized.stderr);
    const text = readFileSync(envFile, "utf8");
    assert.match(text, /WORKNOTE_PASSWORD="[A-Za-z0-9_-]{24}"/);
    assert.match(text, /WORKNOTE_SECRET="[a-f0-9]{64}"/);
    assert.equal(statSync(envFile).mode & 0o777, 0o600);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
