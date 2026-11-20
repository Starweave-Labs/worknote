/** Shared daily-record index writer for record CLI and completion-generated day logs. */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { atomicWrite } from "./todo-write.js";

export function updateDayIndex(root: string, slug: string, project: string, system: string, date: string, summary?: string): void {
  const file = join(root, "index.md");
  const previous = existsSync(file) ? readFileSync(file, "utf8").replace(/\r\n/g, "\n") : "# 工作记录索引\n";
  const lines = previous.split("\n");
  const prefix = `- [${date}](projects/${slug}/daily/${date.slice(0, 7)}/${date}/${date}.md)`;
  const link = (text: string) => `${prefix} — ${text.replace(/\s*\n\s*/g, " ").trim()}`;
  const save = () => {
    const next = lines.join("\n");
    if (next !== previous) atomicWrite(file, next);
  };
  const start = lines.findIndex((line) => line.trim() === `## ${project}`);
  if (start < 0) {
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    lines.push("", `## ${project}`, "", `- 系统：${system}`, `- 目录：[projects/${slug}](projects/${slug}/)`, "", `### ${date.slice(0, 7)}`, "", link(summary ?? ""), "");
    save();
    return;
  }
  let end = lines.findIndex((line, index) => index > start && /^##\s/.test(line));
  if (end < 0) end = lines.length;
  const existing = lines.findIndex((line, index) => index > start && index < end && line.trim().startsWith(prefix));
  if (existing >= 0) {
    // A completion must not replace a previously written daily summary with an empty one.
    if (summary !== undefined) lines[existing] = link(summary);
    save();
    return;
  }
  const month = date.slice(0, 7);
  const monthStart = lines.findIndex((line, index) => index > start && index < end && line.trim() === `### ${month}`);
  if (monthStart < 0) {
    let at = end;
    for (let i = start + 1; i < end; i++) {
      const match = lines[i].trim().match(/^### (\d{4}-\d{2})$/);
      if (match && match[1] < month) { at = i; break; }
    }
    lines.splice(at, 0, `### ${month}`, "", link(summary ?? ""), "");
  } else {
    let at = monthStart + 1;
    while (at < end && !lines[at].trim()) at++;
    while (at < end) {
      const match = lines[at].trim().match(/^- \[(\d{4}-\d{2}-\d{2})\]\(/);
      if (match && match[1] < date) break;
      if (/^###\s/.test(lines[at])) break;
      at++;
    }
    lines.splice(at, 0, link(summary ?? ""));
  }
  save();
}
