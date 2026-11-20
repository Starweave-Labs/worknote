/**
 * 把「完成示例」写入当日工作记录,使其出现在当日页的概要区。
 *
 * 沿用当日记录既有的条目机制(`## HH:MM 标题` + 字段),不新增文件格式、不改解析器。
 * 类型标为「修改」不合适——完成情况属于进展,故用「优化」? 不:新增「已完成」语义
 * 由条目标题表达,类型沿用原待办类型,便于站点统计一致。
 */

import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { atomicWrite } from "./todo-write.js";
import { updateDayIndex } from "./day-index.js";

const COLON = "\uFF1A";

export interface DayEntryInput {
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  title: string;
  type: string;
  module: string;
  content: string;
  /** 图片相对路径(projects/... 或 attachments/...),用 Markdown 内嵌。 */
  images: { alt: string; src: string }[];
  /** 来源链接(todo.md 相对路径或站点路径),可选。 */
  sourceNote?: string;
  projectName?: string;
  systemName?: string;
}

/** 当日记录文件的绝对路径;目录不存在时创建。 */
export function dayFilePath(root: string, slug: string, date: string): string {
  const month = date.slice(0, 7);
  const dir = join(root, "projects", slug, "daily", month, date);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o755 });
  return join(dir, `${date}.md`);
}

/** 把站内附件路径转为记录内可用的相对路径(attachments/xxx.png)。 */
function toRelImage(src: string): string {
  const m = src.match(/\/attachments\/([^/]+)\/(\d{4}-\d{2}-\d{2})\/(.+)$/);
  if (m) return `attachments/${m[3]}`;
  const m2 = src.match(/^projects\/[^/]+\/daily\/\d{4}-\d{2}\/\d{4}-\d{2}-\d{2}\/attachments\/(.+)$/);
  if (m2) return `attachments/${m2[1]}`;
  return src;
}

/**
 * 追加一条完成记录到当日文件。
 * 若当日文件不存在,按模板新建。
 */
export function appendDayCompletion(root: string, slug: string, input: DayEntryInput): void {
  const file = dayFilePath(root, slug, input.date);
  const entry = buildEntry(input);

  if (!existsSync(file)) {
    // 当日文件不存在:按模板新建(带上项目与首选系统名称)
    const pName = input.projectName || "";
    const sName = input.systemName || "";
    const tpl =
      `# ${input.date} 工作记录\n\n` +
      `- **项目**${COLON}${pName}\n` +
      `- **系统**${COLON}${sName}\n\n` +
      `> 概要${COLON}\n\n` +
      entry +
      `---\n`;
    atomicWrite(file, tpl);
    updateDayIndex(root, slug, pName || slug, sName, input.date);
    return;
  }

  const text = readFileSync(file, "utf-8").replace(/\r\n/g, "\n");
  // 末尾若是分隔线 `---`,插到它之前,保持在同一天条目序列里
  const trimmed = text.replace(/\s+$/, "\n");
  const hadSep = /\n---\s*$/.test(trimmed);
  const body = hadSep ? trimmed.replace(/\n---\s*$/, "\n") : trimmed;
  const prefix = body.endsWith("\n\n") ? body : (body.endsWith("\n") ? `${body}\n` : `${body}\n\n`);
  atomicWrite(file, `${prefix}${entry}---\n`);
  const project = input.projectName || text.match(/^-\s*\*\*项目\*\*：(.+)$/m)?.[1]?.trim() || slug;
  const system = input.systemName || text.match(/^-\s*\*\*系统\*\*：(.+)$/m)?.[1]?.trim() || "";
  const summary = text.match(/^>\s*概要：(.+)$/m)?.[1]?.trim();
  updateDayIndex(root, slug, project, system, input.date, summary);
}

function buildEntry(input: DayEntryInput): string {
  const lines: string[] = [];
  lines.push(`## ${input.time} ${input.title}`, "");
  lines.push(`- **类型**${COLON}${input.type || "修改"}`);
  lines.push(`- **模块**${COLON}${input.module || "待办完成"}`);
  lines.push(`- **内容**${COLON}${input.content.replace(/\s*\n\s*/g, " ")}`);
  if (input.sourceNote) lines.push(`- **来源**${COLON}${input.sourceNote}`);
  if (input.images.length) {
    lines.push(`- **附件**${COLON}`, "");
    for (const im of input.images) {
      lines.push(`  ![${im.alt || "完成截图"}](${toRelImage(im.src)})`, "");
    }
  }
  lines.push("");
  return lines.join("\n");
}