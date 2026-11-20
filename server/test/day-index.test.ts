import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { updateDayIndex } from "../src/day-index.js";
import { appendDayCompletion } from "../src/daylog-write.js";

test("day index sorts dates and months newest first and preserves summaries on completion", (t) => {
  const root = mkdtempSync(join(tmpdir(), "worknote-day-index-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const date of ["2026-10-15", "2026-11-05", "2026-11-03", "2026-11-10", "2026-09-01"]) {
    updateDayIndex(root, "example", "示例项目", "演示系统", date, `概要 ${date}`);
  }
  updateDayIndex(root, "example", "示例项目", "演示系统", "2026-11-05");
  const text = readFileSync(join(root, "index.md"), "utf8");
  const months = [...text.matchAll(/^### (\d{4}-\d{2})$/gm)].map((match) => match[1]);
  const dates = [...text.matchAll(/^- \[(\d{4}-\d{2}-\d{2})\]/gm)].map((match) => match[1]);
  assert.deepEqual(months, ["2026-11", "2026-10", "2026-09"]);
  assert.deepEqual(dates, ["2026-11-10", "2026-11-05", "2026-11-03", "2026-10-15", "2026-09-01"]);
  assert.match(text, /2026-11-05\.md\) — 概要 2026-11-05/);
});

test("completion-created daily record is indexed exactly once", (t) => {
  const root = mkdtempSync(join(tmpdir(), "worknote-day-completion-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const input = { date: "2026-11-20", time: "09:00", title: "已完成:示例", type: "需求", module: "待办完成", content: "完成测试", images: [], projectName: "示例项目", systemName: "演示系统" };
  appendDayCompletion(root, "example", input);
  appendDayCompletion(root, "example", { ...input, time: "10:00", title: "已完成:另一个示例" });
  const index = readFileSync(join(root, "index.md"), "utf8");
  assert.equal((index.match(/- \[2026-11-20\]/g) || []).length, 1);
  assert.match(index, /projects\/example\/daily\/2026-11\/2026-11-20\/2026-11-20\.md/);
  assert.match(index, /## 示例项目/);
});
