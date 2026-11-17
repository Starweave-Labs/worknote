import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, statSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { buildTodoLine, parseTodoLine, isTodoProgress } from "../src/todo-format.js";
import { createTodo } from "../src/todo-create.js";
import { markTodoDone, markTodoUndone, updateTodo } from "../src/todo-write.js";
import { parseTodo, searchTodos } from "../src/parser.js";

const STAMP = "2026-11-17 10:00";
const SOURCE = "projects/example/daily/2026-11/2026-11-16/2026-11-16.md#09-00-修复测试页面";
const SUB_BLOCK = [
  "  - **完成情况**：原有完成说明",
  "  - **完成附件**：",
  "    ![截图](projects/example/daily/2026-11/2026-11-16/attachments/example.png)",
  "  - **反馈**：[测试方 · 2026-11-16 10:00] 待复验",
  "    - **回复**：[管理员 · 2026-11-16 11:00] 已收到",
].join("\n");

function fixture(t: { after: (fn: () => void) => void }, body: string) {
  const root = mkdtempSync(join(tmpdir(), "worknote-progress-unit-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const file = join(root, "todo.md");
  writeFileSync(join(root, "projects.json"), JSON.stringify([
    { slug: "example", name: "示例项目", system: "示例系统" },
    { slug: "example-two", name: "另一个示例项目", system: "隔离系统" },
  ]));
  const daily = join(root, "projects", "example", "daily", "2026-11", "2026-11-16");
  mkdirSync(join(daily, "attachments"), { recursive: true });
  writeFileSync(join(daily, "2026-11-16.md"), "# 2026-11-16 工作记录\n\n- **项目**：示例项目\n- **系统**：示例系统\n\n> 概要：虚构测试\n\n## 09:00 修复测试页面\n\n- **类型**：修改\n- **模块**：示例模块\n- **内容**：虚构夹具\n\n---\n");
  writeFileSync(join(daily, "attachments", "example.png"), Buffer.from("isolated-image"));
  writeFileSync(file, `# 待办清单\n\n## 未完成\n\n### 示例项目 · 示例系统\n\n${body}\n\n## 已完成\n`);
  return { root, file };
}

function mainOf(file: string, name: string) {
  const line = readFileSync(file, "utf8").split("\n").find((line) => parseTodoLine(line)?.name === name);
  assert.ok(line);
  return parseTodoLine(line)!;
}

test("historical checkboxes default to 0/100 without rewriting", (t) => {
  const { root, file } = fixture(t, "- [ ] 原未完成 | 类型：需求\n- [X] 原已完成 —— **已于 2026-11-16 完成** | 类型：修改");
  const raw = readFileSync(file, "utf8");
  const data = parseTodo(file);
  assert.equal(data.open[0].progress, 0);
  assert.equal(data.done[0].progress, 100);
  assert.equal(readFileSync(file, "utf8"), raw);
  assert.equal(parseTodo(join(root, "missing.md")).open.length, 0);
});

test("progress format is optional, preserves zero, and rejects invalid generators", () => {
  for (const value of [0, 1, 50, 79, 80, 99, 100]) {
    assert.ok(isTodoProgress(value));
    const line = buildTodoLine({ name: "测试", priority: "高", progress: value, start: "2026-11-17", due: "2026-11-19", type: "需求", source: SOURCE });
    assert.ok(line.includes(`| 进度：${value} | 预计开始`));
    const parsed = parseTodoLine(value === 100 ? line.replace("[ ]", "[x]") : line)!;
    assert.equal(parsed.progress, value);
    assert.equal(parsed.name, "测试");
    assert.equal(parsed.start, "2026-11-17");
    assert.equal(parsed.source, SOURCE);
  }
  assert.ok(!buildTodoLine({ name: "旧格式" }).includes("进度"));
  assert.equal(parseTodoLine("- [ ] 测试 —— 文内进度：80,不是字段 | 进度：36 | 类型：需求")?.progress, 36);
  for (const bad of [-1, 101, 1.5, NaN, Infinity, "50", null, false]) {
    assert.ok(!isTodoProgress(bad));
    assert.throws(() => buildTodoLine({ name: "测试", progress: bad as number }), /整数/);
  }
});

test("create progress 0/99/100 is written atomically with status and timestamp", (t) => {
  const { file } = fixture(t, "");
  for (const progress of [0, 99, 100]) {
    const name = `新事项${progress}`;
    const r = createTodo(file, { projectName: "示例项目", name, progress, stamp: STAMP, type: "需求", start: "2026-11-17", due: "2026-11-20" });
    assert.ok(r.ok);
    const main = mainOf(file, name);
    assert.equal(main.progress, progress);
    assert.equal(main.checked, progress === 100);
    assert.equal(main.note.includes(STAMP), progress === 100);
  }
  const raw = readFileSync(file, "utf8");
  assert.ok(!createTodo(file, { projectName: "示例项目", name: "不合法", progress: 30.5 }).ok);
  assert.equal(readFileSync(file, "utf8"), raw);
});

test("0→99→100→partial preserves all metadata and sub-blocks", (t) => {
  const name = "修复测试页面";
  const { file } = fixture(t, `${buildTodoLine({ name, note: "说明文字", source: SOURCE, sourceText: "2026-11-16 09:00", start: "2026-11-17", due: "2026-11-20", type: "修改" })}\n${SUB_BLOCK}`);
  assert.equal(updateTodo(file, name, SOURCE, { progress: 99 }, STAMP), "ok");
  assert.equal(mainOf(file, name).checked, false);
  assert.equal(mainOf(file, name).progress, 99);
  assert.equal(updateTodo(file, name, SOURCE, { progress: 100 }, STAMP), "ok");
  assert.equal(mainOf(file, name).progress, 100);
  assert.equal(mainOf(file, name).checked, true);
  assert.ok(mainOf(file, name).note.includes(`**已于 ${STAMP} 完成**`));
  assert.equal(mainOf(file, name).due, "2026-11-20");
  const doneText = readFileSync(file, "utf8");
  assert.equal(updateTodo(file, name, SOURCE, { progress: 100 }, "2026-11-18 11:00"), "ok");
  assert.equal(readFileSync(file, "utf8"), doneText);
  assert.equal(updateTodo(file, name, SOURCE, { progress: 47 }, STAMP), "ok");
  assert.equal(mainOf(file, name).progress, 47);
  assert.equal(mainOf(file, name).checked, false);
  assert.ok(!mainOf(file, name).note.includes("**已于"));
  assert.ok(readFileSync(file, "utf8").includes(SUB_BLOCK));
  assert.equal(mainOf(file, name).source, SOURCE);
});

test("explicit complete sets 100; undo resets 0 and preserves feedback", (t) => {
  const name = "直接完成";
  const { file } = fixture(t, `${buildTodoLine({ name, progress: 32, source: SOURCE, due: "2026-11-19" })}\n${SUB_BLOCK}`);
  assert.equal(markTodoDone(file, name, SOURCE, STAMP), "done");
  assert.equal(mainOf(file, name).progress, 100);
  assert.equal(mainOf(file, name).due, "2026-11-19");
  assert.equal(markTodoDone(file, name, SOURCE, "2026-11-18 10:00"), "already");
  assert.ok(mainOf(file, name).note.includes(STAMP));
  assert.equal(markTodoUndone(file, name, SOURCE), "undone");
  assert.equal(mainOf(file, name).progress, 0);
  assert.equal(markTodoUndone(file, name, SOURCE), "already");
  assert.ok(readFileSync(file, "utf8").includes(SUB_BLOCK));
});

test("content edits preserve progress and invalid progress cannot write", (t) => {
  const name = "部分完成事项";
  const { file } = fixture(t, buildTodoLine({ name, note: "原说明", progress: 61, source: SOURCE }));
  updateTodo(file, name, SOURCE, { note: "新说明", priority: "高" });
  assert.equal(mainOf(file, name).progress, 61);
  const raw = readFileSync(file, "utf8");
  for (const value of [-1, 101, 20.1, "50", null]) {
    assert.throws(() => updateTodo(file, name, SOURCE, { progress: value as number }), /整数/);
    assert.equal(readFileSync(file, "utf8"), raw);
  }
});

test("completion markers never pollute date or progress field values", (t) => {
  const { file } = fixture(t, "- [ ] 只有排期 —— 说明 | 预计开始：2026-11-17 | 预计完成：2026-11-20");
  markTodoDone(file, "只有排期", "", STAMP);
  const main = mainOf(file, "只有排期");
  assert.equal(main.start, "2026-11-17");
  assert.equal(main.due, "2026-11-20");
  assert.equal(main.progress, 100);
  assert.ok(main.note.includes(STAMP));
  const line = readFileSync(file, "utf8").split("\n").find((l) => l.startsWith("- [x]"))!;
  assert.ok(line.indexOf("**已于") < line.indexOf("| 进度："));
});

test("same-name source-qualified edits affect only the intended task", (t) => {
  const { file } = fixture(t, `${buildTodoLine({ name: "同名", progress: 10, source: "projects/example/one.md#a" })}\n${buildTodoLine({ name: "同名", progress: 20, source: "projects/example/two.md#b" })}`);
  updateTodo(file, "同名", "projects/example/two.md#b", { progress: 70 });
  const { open } = parseTodo(file);
  assert.equal(open.find((t) => t.source.endsWith("#a"))?.progress, 10);
  assert.equal(open.find((t) => t.source.endsWith("#b"))?.progress, 70);
});

test("source-empty same-name task remains independently editable", (t) => {
  const { file } = fixture(t, `${buildTodoLine({ name: "重名来源测试", progress: 12, source: SOURCE })}\n${buildTodoLine({ name: "重名来源测试", progress: 30 })}`);
  assert.equal(updateTodo(file, "重名来源测试", "", { progress: 100 }, STAMP), "ok");
  const data = parseTodo(file);
  assert.equal(data.open.find((x) => x.source === SOURCE)?.progress, 12);
  assert.equal(data.done.find((x) => x.source === "")?.progress, 100);
});

test("reserved name delimiters are rejected before create writes", (t) => {
  const { file } = fixture(t, "");
  const raw = readFileSync(file, "utf8");
  for (const name of ["接口验收 —— 第二轮", "名称 | 进度：100", "两行\n名称", "名称**已于 2026-11-17 完成**"]) {
    assert.equal(createTodo(file, { projectName: "示例项目", name, progress: 100 }).ok, false);
    assert.equal(readFileSync(file, "utf8"), raw);
  }
});

test("reopening a date-mixed completed task retains its owning project", (t) => {
  const { file } = fixture(t, buildTodoLine({ name: "无关项目开放", type: "需求" }));
  writeFileSync(file, `# 待办\n\n## 未完成\n\n### 另一个示例项目 · 隔离系统\n\n- [ ] 无关项目开放\n\n## 已完成\n\n- [x] 原示例项目完成 —— **已于 2026-11-16 完成** | 类型：修改 | 来源：[2026-11-16 09:00](${SOURCE})\n`);
  assert.equal(markTodoUndone(file, "原示例项目完成", SOURCE), "undone");
  const task = parseTodo(file).open.find((x) => x.name === "原示例项目完成")!;
  assert.equal(task.group, "示例项目");
  assert.equal(task.progress, 0);
});

test("atomic replacement invalidates parse cache even if mtime and byte size match", (t) => {
  const { file, root } = fixture(t, buildTodoLine({ name: "缓存测试", progress: 31 }));
  assert.equal(parseTodo(file).open[0].progress, 31);
  const initial = statSync(file);
  updateTodo(file, "缓存测试", "", { progress: 42 });
  assert.equal(statSync(file).size, initial.size);
  utimesSync(file, initial.atime, initial.mtime);
  assert.equal(parseTodo(file).open[0].progress, 42);
  assert.equal(searchTodos(root, "缓存测试")[0].progress, 42);
});
