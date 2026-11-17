import test from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync, chmodSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import { collect, parseTodo } from "../src/parser.js";

const SERVER = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PASSWORD = "isolated-progress-test-password";

async function port(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const value = address.port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return value;
}

function fixture(root: string) {
  const today = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const date = `${today.getFullYear()}-${p(today.getMonth() + 1)}-${p(today.getDate())}`;
  writeFileSync(join(root, "projects.json"), JSON.stringify([
    { slug: "example", name: "示例项目", system: "隔离测试" },
    { slug: "example-two", name: "另一个示例项目", system: "隔离测试" },
    { slug: "empty-project", name: "空示例项目", system: "默认系统" },
    { slug: "underscore_project", name: "下划线示例项目", system: "隔离测试" },
    { slug: "alias-project", name: "别名示例项目", system: "隔离测试" },
  ]));
  for (const [slug, name] of [["example", "示例项目"], ["example-two", "另一个示例项目"]]) {
    const file = join(root, "projects", slug, "daily", date.slice(0, 7), date, `${date}.md`);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `# ${date} 工作记录\n\n- **项目**：${name}\n- **系统**：隔离测试\n\n> 概要：测试夹具\n\n## 09:00 测试夹具\n\n- **类型**：需求\n- **模块**：测试模块\n- **内容**：隔离验证,非真实记录\n\n---\n`);
  }
  writeFileSync(join(root, "todo.md"), "# 待办清单\n\n## 未完成\n\n### 示例项目 · 隔离测试\n\n- [ ] 分享完成验证 | 进度：40 | 类型：需求\n\n### 另一个示例项目 · 隔离测试\n\n- [ ] 另一项目待办 | 进度：20 | 类型：需求\n\n## 已完成\n");
  writeFileSync(join(root, "index.md"), "# 工作记录索引\n");
  writeFileSync(join(root, "site-config.json"), "{}\n");
  writeFileSync(join(root, "shares.json"), JSON.stringify({ shares: [
    { token: "isolated-view-token", project: "example", mode: "view", feedbackBy: "测试方", label: "只读", createdAt: new Date().toISOString() },
    { token: "isolated-edit-token", project: "example", mode: "edit", feedbackBy: "测试方", label: "可完成", createdAt: new Date().toISOString() },
  ] }));
  return date;
}

async function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
    setTimeout(() => { child.kill("SIGKILL"); resolve(); }, 1500).unref();
  });
}

test("isolated API progress lifecycle, idempotent completion, and read-only sharing", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "worknote-progress-api-"));
  const value = await port();
  const base = `http://127.0.0.1:${value}`;
  const date = fixture(root);
  // A stub would flag any accidental systemctl invocation without touching the host service manager.
  const stubBin = join(root, "stubs");
  mkdirSync(stubBin);
  writeFileSync(join(stubBin, "systemctl"), "#!/bin/sh\nprintf '%s\\n' invoked >> \"$WORKNOTE_ROOT/systemctl-invoked\"\nexit 1\n");
  chmodSync(join(stubBin, "systemctl"), 0o755);
  let log = "";
  const child = spawn(join(SERVER, "node_modules", ".bin", "tsx"), [join(SERVER, "src", "index.ts")], {
    cwd: SERVER,
    env: { ...process.env, PATH: `${stubBin}:${process.env.PATH}`, WORKNOTE_ENV_FILE: "", WORKNOTE_ROOT: root, PORT: String(value), HOST: "127.0.0.1", WORKNOTE_PASSWORD: PASSWORD, WORKNOTE_SECRET: "isolated-test-secret-not-production", WORKNOTE_AI_URL: "", WORKNOTE_AI_KEY: "", WORKNOTE_AI_MODEL: "", WORKNOTE_NOTIFY_WEBHOOK: "", WORKNOTE_SYSTEMD: "", WORKNOTE_GIT_SNAPSHOT: "", WORKNOTE_TRUST_PROXY: "", WORKNOTE_SERVE_CLIENT: "false" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (s) => { log += s.toString(); });
  child.stderr?.on("data", (s) => { log += s.toString(); });
  t.after(async () => { await stop(child); rmSync(root, { recursive: true, force: true }); });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error(`API failed to boot: ${log}`);
    try {
      if ((await fetch(`${base}/api/health`)).ok) { ready = true; break; }
    } catch { /* wait for isolated process */ }
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.ok(ready, log);
  const login = await fetch(`${base}/api/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: PASSWORD }) });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie);

  async function api(path: string, method = "GET", body?: unknown, auth = true, custom = true) {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { "Content-Type": "application/json", ...(auth ? { Cookie: cookie! } : {}), ...(custom ? { "X-Requested-With": "worknote" } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: res.status, data: await res.json() as any };
  }

  assert.equal((await api("/api/projects", "GET", undefined, false)).status, 401);
  const registry = await api("/api/projects");
  assert.equal(registry.status, 200);
  const empty = registry.data.projects.find((p: any) => p.slug === "empty-project");
  assert.deepEqual(empty.systems, ["默认系统"]);
  assert.equal(empty.dayCount, 0);
  assert.equal(empty.entryCount, 0);
  assert.deepEqual(empty.dateRange, ["", ""]);
  assert.ok(!("days" in empty));
  assert.equal((await api("/api/projects/empty-project")).data.days.length, 0);
  const settings = await api("/api/settings");
  assert.equal(settings.data.agent.level, "off");
  assert.equal((await api("/api/agent/status")).data.level, "off");
  assert.equal((await api("/api/agent/run", "POST", {})).status, 503);
  const savedTime = await api("/api/settings", "POST", { digestTime: "09:15" });
  assert.equal(savedTime.status, 200);
  assert.equal(savedTime.data.timerSynced, false);
  assert.match(savedTime.data.timerMessage || savedTime.data.timer.error, /外部调度器/);
  assert.equal(JSON.parse(readFileSync(join(root, "site-config.json"), "utf8")).digestTime, "09:15");
  assert.equal((await api("/api/settings", "POST", { reset: true })).data.timerSynced, false);
  assert.equal(existsSync(join(root, "systemctl-invoked")), false);

  const emptyCreated = await api("/api/todos", "POST", { project: "empty-project", name: "空项目新建验证", type: "需求", progress: 25 });
  assert.equal(emptyCreated.status, 200);
  assert.equal(emptyCreated.data.item.group, "空示例项目 · 默认系统");
  assert.equal((await api("/api/todos", "PATCH", { name: "空项目新建验证", patch: { project: "example-two" } })).data.item.group, "另一个示例项目 · 隔离测试");
  assert.equal((await api("/api/todos", "PATCH", { name: "空项目新建验证", patch: { project: "empty-project" } })).data.item.group, "空示例项目 · 默认系统");

  const initial = await api("/api/todo");
  assert.equal(initial.status, 200);
  assert.equal(initial.data.open[0].progress, 40);
  const raw = readFileSync(join(root, "todo.md"), "utf8");
  for (const bad of [-1, 101, 2.5, "50", null, true]) {
    assert.equal((await api("/api/todos", "PATCH", { name: "分享完成验证", patch: { progress: bad } })).status, 400);
    assert.equal(readFileSync(join(root, "todo.md"), "utf8"), raw);
  }
  assert.equal((await api("/api/todos", "POST", { project: "示例项目", name: "非法初始进度", progress: "20" })).status, 400);

  const created = await api("/api/todos", "POST", { project: "示例项目", name: "进度往返测试", progress: 37, type: "修改", start: date, due: date });
  assert.equal(created.status, 200);
  assert.equal(created.data.progress, 37);
  assert.equal(created.data.done, false);
  assert.deepEqual(created.data.previous, { name: "进度往返测试", source: "" });
  assert.equal((await api("/api/todos", "POST", { project: "示例项目", name: "进度往返测试" })).status, 409);
  assert.equal((await api("/api/todos", "PATCH", { name: "进度往返测试", patch: { progress: 99 } })).data.done, false);

  const completed = await api("/api/todos", "PATCH", { name: "进度往返测试", patch: { progress: 100 } });
  assert.equal(completed.status, 200);
  assert.equal(completed.data.done, true);
  assert.equal(completed.data.progress, 100);
  assert.equal(completed.data.dayWritten, true);
  const daily = join(root, "projects", "example", "daily", date.slice(0, 7), date, `${date}.md`);
  const first = readFileSync(daily, "utf8");
  assert.equal((first.match(/已完成:进度往返测试/g) ?? []).length, 1);
  assert.ok(completed.data.item.note.includes("**已于"));
  assert.equal((await api("/api/todos", "PATCH", { name: "进度往返测试", patch: { progress: 100 } })).data.dayWritten, false);
  assert.equal(readFileSync(daily, "utf8"), first);

  const explaining = await api("/api/todos/complete", "POST", { name: "进度往返测试", project: "示例项目", text: "补写说明" });
  assert.equal(explaining.status, 200);
  assert.equal(explaining.data.result, "already");
  assert.equal(explaining.data.progress, 100);
  assert.equal(readFileSync(daily, "utf8"), first);

  const open = await api("/api/todos", "PATCH", { name: "进度往返测试", patch: { progress: 63 } });
  assert.equal(open.data.done, false);
  assert.equal(open.data.item.completion.text, "补写说明");
  assert.ok(!open.data.item.note.includes("**已于"));
  assert.equal(open.data.item.start, date);
  assert.equal(open.data.item.due, date);
  assert.equal((await api("/api/todos", "PATCH", { name: "进度往返测试", patch: { note: "仅编辑内容" } })).data.progress, 63);
  assert.equal((await api("/api/todos/complete", "POST", { name: "进度往返测试", text: "真正完成" })).data.progress, 100);
  assert.equal((await api("/api/todos/undone", "POST", { name: "进度往返测试" })).data.progress, 0);

  const safeBefore = readFileSync(join(root, "todo.md"), "utf8");
  assert.equal((await api("/api/todos", "POST", { project: "示例项目", name: "名称 —— 说明分隔", progress: 100 })).status, 400);
  assert.equal((await api("/api/todos", "PATCH", { name: "进度往返测试", patch: { name: "名称 | 进度：100", progress: 100 } })).status, 400);
  assert.equal(readFileSync(join(root, "todo.md"), "utf8"), safeBefore);

  // 手工历史可能已有同名项;明确空来源仍可唯一定位,分享不能跨项目误写。
  const source = `projects/example/daily/${date.slice(0, 7)}/${date}/${date}.md#09-00-测试夹具`;
  writeFileSync(join(root, "todo.md"), `# 待办\n\n## 未完成\n\n### 示例项目 · 隔离测试\n\n- [ ] 同名范围 | 进度：10 | 类型：需求 | 来源：[${date} 09:00](${source})\n\n### 另一个示例项目 · 隔离测试\n\n- [ ] 同名范围 | 进度：20 | 类型：需求\n\n## 已完成\n\n` + readFileSync(join(root, "todo.md"), "utf8").split("## 已完成")[1]);
  const second = await api("/api/todos", "PATCH", { name: "同名范围", source: "", patch: { progress: 53 } });
  assert.equal(second.status, 200);
  assert.equal(second.data.progress, 53);
  assert.equal(second.data.item.group, "另一个示例项目 · 隔离测试");
  assert.equal((await api("/api/todos", "PATCH", { name: "同名范围", patch: { progress: 100 } })).status, 404);
  assert.equal((await api("/api/share/isolated-edit-token/feedback", "POST", { name: "同名范围", text: "不能越权" }, false)).status, 403);
  assert.equal((await api("/api/share/isolated-edit-token/feedback", "POST", { name: "同名范围", source: "", text: "不能越权" }, false)).status, 403);
  assert.equal((await api("/api/share/isolated-edit-token/feedback", "POST", { name: "同名范围", source, text: "本项目正常" }, false)).status, 200);
  const scopes = parseTodo(join(root, "todo.md")).open;
  assert.equal(scopes.find((x) => x.source === source)?.feedback[0].text, "本项目正常");
  assert.equal(scopes.find((x) => x.name === "同名范围" && x.source === "")?.feedback.length, 0);
  // 恢复本测试既有夹具,便于继续验证分享完成。
  writeFileSync(join(root, "todo.md"), safeBefore);

  const hundred = await api("/api/todos/ai-create", "POST", { project: "示例项目", name: "直接创建完成", type: "需求", progress: 100 });
  assert.equal(hundred.status, 200);
  assert.equal(hundred.data.done, true);
  assert.equal(hundred.data.progress, 100);
  assert.equal(hundred.data.dayWritten, true);

  const imagePrefix = `projects/example/daily/${date.slice(0, 7)}/${date}/attachments/`;
  const imagesDir = join(root, imagePrefix);
  mkdirSync(imagesDir, { recursive: true });
  const imageBytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6pJkAAAAASUVORK5CYII=", "base64");
  writeFileSync(join(imagesDir, "authorized.png"), imageBytes);
  writeFileSync(join(imagesDir, "private-record.png"), imageBytes);
  const outside = join(root, "outside.png");
  writeFileSync(outside, imageBytes);
  symlinkSync(outside, join(imagesDir, "linked.png"));
  assert.equal((await api("/api/todos", "PATCH", { name: "分享完成验证", patch: { note: `![允许](${imagePrefix}authorized.png) ![链接](${imagePrefix}linked.png)` } })).status, 200);
  const allShare = await api("/api/shares", "POST", { project: "_all", mode: "view" });
  assert.equal(allShare.status, 200);
  const slugShare = await api("/api/shares", "POST", { project: "example-two", mode: "view" });
  assert.equal(slugShare.status, 200);
  assert.equal((await api("/api/shares", "POST", { project: "underscore_project", mode: "view" })).status, 200);
  symlinkSync(join(root, "projects", "example"), join(root, "projects", "alias-project"), "dir");
  const aliasShare = await api("/api/shares", "POST", { project: "alias-project", mode: "view" });
  const aliasImage = imagePrefix.replace("projects/example/", "projects/alias-project/") + "authorized.png";
  assert.equal((await api("/api/todos", "POST", { project: "alias-project", name: "别名图片边界测试", type: "需求", note: `![别名](${aliasImage})` })).status, 200);
  assert.equal((await fetch(`${base}/api/share/${aliasShare.data.token}/attachment/${aliasImage}`)).status, 404);
  assert.equal((await fetch(`${base}/attachments/alias-project/${date}/authorized.png`, { headers: { Cookie: cookie! } })).status, 404);
  for (const token of ["isolated-view-token", allShare.data.token]) {
    const prefix = `${base}/api/share/${token}/attachment/`;
    const allowed = await fetch(prefix + imagePrefix + "authorized.png");
    assert.equal(allowed.status, 200);
    assert.deepEqual(Buffer.from(await allowed.arrayBuffer()), imageBytes);
    assert.ok([403, 404].includes((await fetch(prefix + imagePrefix + "private-record.png")).status));
    assert.ok([403, 404].includes((await fetch(prefix + imagePrefix + "linked.png")).status));
    assert.ok([403, 404].includes((await fetch(prefix + `projects/example/daily/${date.slice(0, 7)}/${date}/${date}.md`)).status));
    assert.ok([403, 404].includes((await fetch(prefix + "projects/example/modules.md")).status));
    const wrongMonth = imagePrefix.replace(`/daily/${date.slice(0, 7)}/`, "/daily/1900-01/");
    assert.equal((await fetch(prefix + wrongMonth + "authorized.png")).status, 403);
  }
  const adminImage = await fetch(`${base}/attachments/example/${date}/authorized.png`, { headers: { Cookie: cookie! } });
  assert.equal(adminImage.status, 200);
  assert.ok([400, 404].includes((await fetch(`${base}/attachments/example/2026-02-30/authorized.png`, { headers: { Cookie: cookie! } })).status));
  assert.ok([400, 404].includes((await fetch(`${base}/attachments/example/%2e%2e%2f%2e%2e%2fprojects-backup/authorized.png`, { headers: { Cookie: cookie! } })).status));
  assert.ok([400, 404].includes((await fetch(`${base}/attachments/example/${date}/linked.png`, { headers: { Cookie: cookie! } })).status));

  const view = await api("/api/share/isolated-view-token", "GET", undefined, false);
  assert.equal(view.status, 200);
  assert.equal(view.data.todo.open.find((x: any) => x.name === "分享完成验证").progress, 40);
  assert.equal((await api("/api/share/isolated-view-token/todo", "POST", { name: "分享完成验证" }, false)).status, 403);
  assert.equal((await api("/api/share/isolated-edit-token/todo", "POST", { name: "分享完成验证", progress: 50 }, false)).status, 403);
  assert.equal((await api("/api/share/isolated-edit-token/todo", "POST", { name: "分享完成验证" }, false, false)).status, 403);
  assert.equal((await api("/api/share/isolated-edit-token/todo", "POST", { name: "另一项目待办" }, false)).status, 403);
  const beforeShare = readFileSync(daily, "utf8");
  const share = await api("/api/share/isolated-edit-token/todo", "POST", { name: "分享完成验证" }, false);
  assert.equal(share.status, 200);
  assert.equal(share.data.done, true);
  assert.equal(share.data.progress, 100);
  assert.equal(readFileSync(daily, "utf8"), beforeShare);
  assert.equal((await api("/api/share/isolated-edit-token/todo", "POST", { name: "分享完成验证" }, false)).status, 403);
  const searched = await api("/api/search?q=进度往返测试");
  assert.equal(searched.data.todos[0].progress, 0);
  assert.equal(searched.data.todos[0].source, "");
  const overview = await api("/api/overview");
  assert.equal(overview.data.todoOpen, parseTodo(join(root, "todo.md")).open.length);
  assert.equal(overview.data.todoDone, parseTodo(join(root, "todo.md")).done.length);
  assert.equal(collect(root).find((p) => p.slug === "empty-project")?.days.length, 0);
  // Changing untrusted forwarding headers cannot reset the login failure budget.
  for (let i = 0; i < 11; i++) {
    const failed = await fetch(`${base}/api/login`, { method: "POST", headers: { "Content-Type": "application/json", "X-Forwarded-For": `198.51.100.${i + 1}` }, body: JSON.stringify({ password: "incorrect-fictional-password" }) });
    assert.equal(failed.status, i === 10 ? 429 : 401);
  }
  assert.ok(!log.includes("isolated-view-token") && !log.includes("isolated-edit-token"));
  assert.ok(!log.includes(allShare.data.token) && !log.includes(aliasShare.data.token));
});
