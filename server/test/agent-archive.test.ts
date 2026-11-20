import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// agent-tools captures ROOT on import; never let it point at a real data root.
const root = mkdtempSync(join(tmpdir(), "worknote-agent-archive-"));
const previousRoot = process.env.WORKNOTE_ROOT;
const previousEnvFile = process.env.WORKNOTE_ENV_FILE;
process.env.WORKNOTE_ROOT = root;
process.env.WORKNOTE_ENV_FILE = "";
after(() => {
  rmSync(root, { recursive: true, force: true });
  if (previousRoot === undefined) delete process.env.WORKNOTE_ROOT;
  else process.env.WORKNOTE_ROOT = previousRoot;
  if (previousEnvFile === undefined) delete process.env.WORKNOTE_ENV_FILE;
  else process.env.WORKNOTE_ENV_FILE = previousEnvFile;
});
const { runTool } = await import("../src/agent-tools.js");
const { parseTodo } = await import("../src/parser.js");

const file = join(root, "todo.md");
const GROUP_A = "示例项目 · 示例系统";
const GROUP_B = "另一项目 · 另一系统";
const SOURCE_A = "projects/example/daily/2026-11/2026-11-16/2026-11-16.md#09-00-示例事项";
const SOURCE_B = "projects/example-two/daily/2026-11/2026-11-16/2026-11-16.md#09-00-另一事项";
const RICH_BLOCK = [
  "  - **完成情况**：原有完成说明",
  "  - **完成附件**：",
  "    ![完成截图](projects/example/attachments/done.png)",
  "  - **反馈**：[测试方 · 2026-11-16 10:00] 请复验",
  "    ![反馈截图](projects/example/attachments/feedback.png)",
  "    - **回复**：[管理员 · 2026-11-16 11:00] 已收到",
  "      ![回复截图](projects/example/attachments/reply.png)",
  "  - **反馈**：[测试方 · 2026-11-17 10:00] 再次反馈",
].join("\n");

function fixture(open: string, done = "") {
  writeFileSync(join(root, "projects.json"), JSON.stringify([
    { slug: "example", name: "示例项目", system: "示例系统" },
    { slug: "example-two", name: "另一项目", system: "另一系统" },
  ]));
  writeFileSync(file, `# 待办清单\n\n## 未完成\n\n${open}\n\n## 已完成\n\n${done}\n`);
}

function snapshot() {
  const { open, done } = parseTodo(file);
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
  return { open: [...open].sort(byName), done: [...done].sort(byName) };
}

function archiveUnchanged() {
  const before = snapshot();
  const result = runTool("move_done_archived", {});
  assert.equal(result.ok, true);
  assert.equal(result.risk, "green");
  assert.deepEqual(snapshot(), before, "archiving must preserve every parsed field and project membership");
  const raw = readFileSync(file, "utf8");
  const openSection = raw.split("## 已完成")[0];
  assert.ok(!/^-\s*\[x\]/m.test(openSection));
  assert.equal(runTool("move_done_archived", {}).ok, true);
  assert.equal(readFileSync(file, "utf8"), raw, "a second archive must not rewrite the file");
  return raw;
}

test("archive preserves website-created and source-migrated ownership, rich blocks and mixed completed items", () => {
  const website = "- [x] 网页创建事项 —— 已处理**已于 2026-11-18 10:00 完成** | 进度：100 | 类型：修改";
  const migrated = `- [x] 已迁移事项 —— 来源仍属原项目 | 进度：100 | 来源：[2026-11-16 09:00](${SOURCE_A})`;
  const mixed = [
    `- [x] 原混排甲 | 来源：[2026-11-16 09:00](${SOURCE_A})`,
    `- [x] 原混排乙 | 来源：[2026-11-16 09:00](${SOURCE_B})`,
    "- [x] 原无来源混排",
    `### ${GROUP_A}`,
    "- [x] 原末尾分组事项",
  ].join("\n\n");
  fixture(`### ${GROUP_A}\n\n${website}\n${RICH_BLOCK}\n- [ ] 原未完成 | 进度：30\n\n### ${GROUP_B}\n\n${migrated}`, mixed);
  const before = snapshot();
  assert.equal(before.done.find((item) => item.name === "网页创建事项")!.group, GROUP_A);
  assert.equal(before.done.find((item) => item.name === "网页创建事项")!.created, true);
  assert.equal(before.done.find((item) => item.name === "已迁移事项")!.group, GROUP_B);
  const raw = archiveUnchanged();
  assert.ok(raw.includes(`${website}\n${RICH_BLOCK}`), "all child blocks and indentation must remain byte-for-byte intact");
  assert.ok(raw.includes(migrated), "the migrated source must not be rewritten");
  assert.ok(raw.includes(`### ${GROUP_B}\n\n${migrated}`));
  assert.equal(snapshot().done.find((item) => item.name === "网页创建事项")!.feedback.length, 2);
});

test("archive does not disturb existing explicit completed groups or their trailing items", () => {
  const oldDone = `### ${GROUP_B}\n\n- [x] 原已完成乙\n${RICH_BLOCK}\n\n### ${GROUP_A}\n\n- [x] 原已完成甲\n- [x] 原末尾甲`;
  fixture(`### ${GROUP_A}\n\n- [x] 新已完成甲\n\n### ${GROUP_B}\n\n- [x] 新已完成乙`, oldDone);
  const raw = archiveUnchanged();
  assert.ok(raw.endsWith(`${oldDone}\n`), "existing grouped completed content must not move or change");
});

test("archive preserves multiple project groups when the completed section is empty", () => {
  fixture(`### ${GROUP_A}\n\n- [x] 已完成甲一\n- [x] 已完成甲二\n\n### ${GROUP_B}\n\n- [x] 已完成乙`);
  const raw = archiveUnchanged();
  const done = raw.slice(raw.indexOf("## 已完成"));
  assert.ok(done.indexOf("已完成乙") < done.indexOf("已完成甲二"));
  assert.ok(done.indexOf("已完成甲二") < done.indexOf("已完成甲一"));
});

test("ungrouped website-created items cannot inherit a newly archived project group", () => {
  fixture(`- [x] 无分组网页事项\n\n### ${GROUP_A}\n\n- [x] 分组事项`, "- [x] 原无分组网页事项");
  archiveUnchanged();
  for (const item of snapshot().done.filter((item) => item.name.includes("无分组"))) {
    assert.equal(item.group, "");
  }
});

test("archive keeps an entirely mixed completed section unchanged before adding grouped blocks", () => {
  const oldDone = `- [x] 原来源甲 | 来源：[2026-11-16 09:00](${SOURCE_A})\n\n- [x] 原来源乙 | 来源：[2026-11-16 09:00](${SOURCE_B})\n\n- [x] 原无来源事项`;
  fixture(`### ${GROUP_B}\n\n- [x] 迁入事项 | 来源：[2026-11-16 09:00](${SOURCE_A})`, oldDone);
  const raw = archiveUnchanged();
  assert.ok(raw.includes(`## 已完成\n\n${oldDone}\n`));
});

test("archive rejects source items without an original group before writing any blocks", () => {
  fixture(`- [x] 无分组来源事项 | 来源：[2026-11-16 09:00](${SOURCE_A})\n\n### ${GROUP_B}\n\n- [x] 正常分组事项`);
  const raw = readFileSync(file, "utf8");
  const before = snapshot();
  assert.equal(runTool("move_done_archived", {}).ok, false);
  assert.equal(readFileSync(file, "utf8"), raw);
  assert.deepEqual(snapshot(), before);
});

test("archive with no stranded completed items does not rewrite anything", () => {
  fixture(`### ${GROUP_A}\n\n- [ ] 未完成事项`, `### ${GROUP_B}\n\n- [x] 已归档事项`);
  const raw = readFileSync(file, "utf8");
  const result = runTool("move_done_archived", {});
  assert.equal(result.ok, true);
  assert.equal(readFileSync(file, "utf8"), raw);
});

test("archive rejects malformed sections without modifying the fixture", () => {
  for (const raw of ["# 待办\n## 未完成\n- [x] 测试\n", "# 待办\n## 已完成\n## 未完成\n- [x] 测试\n"]) {
    writeFileSync(file, raw);
    assert.equal(runTool("move_done_archived", {}).ok, false);
    assert.equal(readFileSync(file, "utf8"), raw);
  }
});
