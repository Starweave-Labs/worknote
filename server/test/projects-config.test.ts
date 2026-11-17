import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { collect, parseTodo } from "../src/parser.js";
import { readProjectConfig, getProjectNames, validateProjectConfig } from "../src/projects.js";
import { createTodo } from "../src/todo-create.js";
import { snapshotAvailability, snapshotData, restoreDataSnapshot } from "../src/data-snapshot.js";

const SERVER = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PROJECTS = [{ slug: "example", name: "示例项目", system: "示例系统" }];

function fixture(t: { after: (fn: () => void) => void }, projects = PROJECTS) {
  const root = mkdtempSync(join(tmpdir(), "worknote-config-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, "projects.json"), JSON.stringify(projects));
  writeFileSync(join(root, "todo.md"), "# 待办清单\n\n## 未完成\n\n## 已完成\n");
  writeFileSync(join(root, "index.md"), "# 工作记录索引\n");
  writeFileSync(join(root, "inbox.md"), "# 收件箱\n");
  writeFileSync(join(root, "site-config.json"), "{}\n");
  return root;
}

function cli(root: string, name: string, args: string[], input?: string) {
  return spawnSync(join(SERVER, "node_modules", ".bin", "tsx"), [join(SERVER, "src", name), ...args], {
    cwd: SERVER,
    env: { ...process.env, WORKNOTE_ENV_FILE: "", WORKNOTE_ROOT: root, WORKNOTE_SYSTEMD: "", WORKNOTE_GIT_SNAPSHOT: "", WORKNOTE_AI_URL: "", WORKNOTE_AI_KEY: "", WORKNOTE_AI_MODEL: "", WORKNOTE_NOTIFY_WEBHOOK: "" },
    encoding: "utf8",
    input,
  });
}

function day(root: string, slug = "example", name = "示例项目", system = "示例系统") {
  const file = join(root, "projects", slug, "daily", "2026-11", "2026-11-16", "2026-11-16.md");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `# 2026-11-16 工作记录\n\n- **项目**：${name}\n- **系统**：${system}\n\n> 概要：虚构样例\n\n## 09:00 示例需求\n\n- **类型**：需求\n- **模块**：示例模块\n- **内容**：仅隔离测试\n\n---\n`);
  return file;
}

test("configured empty projects are collected and create with default system", (t) => {
  const root = fixture(t);
  assert.ok(!existsSync(join(root, "projects")));
  const p = collect(root)[0];
  assert.equal(p.name, "示例项目");
  assert.deepEqual(p.days, []);
  assert.deepEqual(p.counts, {});
  assert.deepEqual(p.dateRange, ["", ""]);
  assert.deepEqual(p.systems, ["示例系统"]);
  assert.deepEqual(createTodo(join(root, "todo.md"), { projectName: p.name, name: "空项目待办", type: "需求" }), { ok: true, group: "示例项目 · 示例系统" });
  assert.equal(parseTodo(join(root, "todo.md")).open[0].progress, 0);
});

test("todo source inference and configuration caches are isolated per root and update live", (t) => {
  const a = fixture(t);
  const b = fixture(t, [{ slug: "example", name: "第二示例", system: "另一系统" }]);
  const source = "projects/example/daily/2026-11/2026-11-16/2026-11-16.md#09-00-示例需求";
  const todo = `# 待办\n\n## 未完成\n\n## 已完成\n\n- [x] 来源测试 | 来源：[2026-11-16 09:00](${source})\n`;
  for (const root of [a, b]) writeFileSync(join(root, "todo.md"), todo);
  assert.equal(parseTodo(join(a, "todo.md")).done[0].group, "示例项目");
  assert.equal(parseTodo(join(b, "todo.md")).done[0].group, "第二示例");
  writeFileSync(join(a, "projects.json"), JSON.stringify([{ slug: "example", name: "第三示例", system: "示例系统" }]));
  assert.equal(parseTodo(join(a, "todo.md")).done[0].group, "第三示例");
  assert.equal(parseTodo(join(b, "todo.md")).done[0].group, "第二示例");
  assert.equal(Object.getPrototypeOf(getProjectNames(a)), null);
});

test("missing registry discovers metadata and modules headers, but present empty registry is authoritative", (t) => {
  const root = fixture(t);
  rmSync(join(root, "projects.json"));
  day(root);
  const modules = join(root, "projects", "example-two", "modules.md");
  mkdirSync(dirname(modules), { recursive: true });
  writeFileSync(modules, "# 第二示例 模块清单\n\n- **系统**：第二系统\n");
  mkdirSync(join(root, "projects", "empty_slug"));
  assert.deepEqual(readProjectConfig(root), [
    { slug: "empty_slug", name: "empty_slug" },
    { slug: "example", name: "示例项目", system: "示例系统" },
    { slug: "example-two", name: "第二示例", system: "第二系统" },
  ]);
  writeFileSync(join(root, "projects.json"), "[]");
  assert.deepEqual(collect(root), []);
});

test("invalid registry, structural labels, traversal, duplicates and prototype keys fail explicitly", (t) => {
  const root = fixture(t);
  const invalid: unknown[] = [
    {}, null, [{ slug: "../escape", name: "示例" }], [{ slug: "Example", name: "示例" }],
    [{ slug: "constructor", name: "示例" }], [{ slug: "example", name: "" }],
    [{ slug: "example", name: "两行\n结构" }], [{ slug: "example", name: "标题 # 内容" }],
    [{ slug: "example", name: "项目 · 系统" }], [{ slug: "example", name: "项目 | 字段" }],
    [{ slug: "example", name: "示例", system: "系统\n## 注入" }],
    [{ slug: "example", name: "示例" }, { slug: "example", name: "另一示例" }],
    [{ slug: "example", name: "示例" }, { slug: "example-two", name: "示例" }],
    JSON.parse('[{"slug":"example","name":"示例","__proto__":{}}]'),
  ];
  for (const value of invalid) assert.throws(() => validateProjectConfig(value), /projects\.json:/);
  writeFileSync(join(root, "projects.json"), "{broken");
  assert.throws(() => collect(root), /projects\.json: JSON/);
  assert.throws(() => parseTodo(join(root, "todo.md")), /projects\.json:/);
});

test("record/query CLI resolve project names and slugs from their own data root", (t) => {
  const root = fixture(t);
  const input = { project: "示例项目", date: "2026-11-16", entries: [{ time: "09:00", title: "示例需求", type: "需求", module: "示例模块", content: "隔离测试" }], todos: [{ name: "示例待办", type: "需求", entryIndex: 0 }] };
  const added = cli(root, "record.ts", ["add"], JSON.stringify(input));
  assert.equal(added.status, 0, added.stderr || added.stdout);
  assert.match(readFileSync(join(root, "projects", "example", "daily", "2026-11", "2026-11-16", "2026-11-16.md"), "utf8"), /\*\*系统\*\*：示例系统/);
  for (const project of ["example", "示例项目"]) {
    const result = cli(root, "query.ts", ["--project", project, "--json"]);
    assert.equal(result.status, 0, result.stderr);
    const data = JSON.parse(result.stdout);
    assert.equal(data.counts.records, 1);
    assert.equal(data.counts.todos, 1);
  }
  const other = fixture(t, [{ slug: "example", name: "另根项目", system: "另一系统" }]);
  assert.ok(createTodo(join(other, "todo.md"), { projectName: "另根项目", name: "另一待办" }).ok);
  const result = cli(other, "query.ts", ["--todo", "--project", "example", "--json"]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).hits[0].project, "另根项目");
  const rejected = cli(root, "record.ts", ["add", "--dry-run"], JSON.stringify({ ...input, project: "../escape" }));
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /projects\.json/);
});

test("Agent is default off and L2 cannot write without a private snapshot", (t) => {
  const root = fixture(t);
  for (const args of [[], ["--run"]]) {
    const result = cli(root, "agent.ts", args);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /关闭/);
    assert.ok(!existsSync(join(root, "agent")));
  }
  const original = readFileSync(join(root, "todo.md"), "utf8");
  const result = cli(root, "agent.ts", ["--level", "L2"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /日志/);
  assert.equal(readFileSync(join(root, "todo.md"), "utf8"), original);
  const replay = cli(root, "digest.ts", ["--date", "2026-11-17", "--no-send", "--json"]);
  assert.equal(replay.status, 0, replay.stderr);
  assert.equal(JSON.parse(replay.stdout).gitCommitted, null);
});

test("snapshots are opt-in, reject parent repositories and limit staged paths (Git stub only)", (t) => {
  const root = fixture(t);
  const previousFlag = process.env.WORKNOTE_GIT_SNAPSHOT;
  const previousPath = process.env.PATH;
  t.after(() => {
    if (previousFlag === undefined) delete process.env.WORKNOTE_GIT_SNAPSHOT; else process.env.WORKNOTE_GIT_SNAPSHOT = previousFlag;
    process.env.PATH = previousPath;
  });
  delete process.env.WORKNOTE_GIT_SNAPSHOT;
  assert.equal(snapshotData(root, "not a real commit").ok, false);
  assert.equal(restoreDataSnapshot(root, "a".repeat(40)).ok, false);
  process.env.WORKNOTE_GIT_SNAPSHOT = "1";
  assert.equal(snapshotAvailability(root).ok, false);
  mkdirSync(join(root, ".git"));
  const nested = join(root, "nested");
  mkdirSync(nested);
  assert.equal(snapshotAvailability(nested).ok, false);
  const bin = join(root, "stub-bin");
  mkdirSync(bin);
  const log = join(root, "git-calls.jsonl");
  const stub = join(bin, "git");
  writeFileSync(stub, `#!${process.execPath}\nconst fs=require('node:fs'); const path=require('node:path'); const a=process.argv.slice(2); fs.appendFileSync(${JSON.stringify(log)},JSON.stringify(a)+'\\n'); const root=a[a.indexOf('-C')+1]; if(a.includes('--show-toplevel')) console.log(root); else if(a.includes('--absolute-git-dir')) console.log(path.join(root,'.git')); else if(a.includes('rev-parse')) console.log('a'.repeat(40));\n`);
  chmodSync(stub, 0o755);
  process.env.PATH = `${bin}:${previousPath}`;
  const snap = snapshotData(root, "stub snapshot");
  assert.equal(snap.ok, true, snap.error);
  const calls = readFileSync(log, "utf8").trim().split("\n").map((line) => JSON.parse(line) as string[]);
  const add = calls.find((args) => args.includes("add"))!;
  assert.ok(add.includes("--"));
  assert.deepEqual(add.slice(add.indexOf("--") + 1), ["projects.json", "todo.md", "index.md", "inbox.md"]);
  assert.ok(!calls.some((args) => args.includes("site-config.json") || args.includes("server") || args.includes("client")));
  assert.equal(restoreDataSnapshot(root, snap.sha).ok, true);
});
