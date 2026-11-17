/**
 * 新建待办:把一条待办写入 todo.md。
 *
 * 位置规则:插入到「## 未完成」下对应 `### <项目显示名> · <系统>` 分组的末尾;
 * 分组不存在则新建一个分组标题。分组标题的第二段(系统名)手工给出或沿用同项目已有分组。
 * 行的字段分隔符强制全角冒号(见 todo-format.ts)。
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { buildTodoLine, isIndented, parseTodoLine, existingGroups, GROUP_SEP, isTodoProgress, todoNameError } from "./todo-format.js";
import { atomicWrite, withTodoProgress, todoStamp } from "./todo-write.js";
import { readProjectConfig } from "./projects.js";

export interface CreateInput {
  /** 项目显示名,如「示例项目」。 */
  projectName: string;
  /** 事项名(必填)。 */
  name: string;
  /** 说明(可选)。 */
  note?: string;
  /** 优先级(可选),如「高」「中」「低」。 */
  priority?: string;
  /** 待办完成进度,0–100整数;缺省0,100创建为已完成。 */
  progress?: number;
  /** 完成时间戳,CLI补记可显式给出。 */
  stamp?: string;
  /** 预计开始日期(可选),YYYY-MM-DD。 */
  start?: string;
  /** 预计完成日期(可选),YYYY-MM-DD。 */
  due?: string;
  /** 类型,取值应属于 TYPE_ORDER。 */
  type?: string;
  /** 来源链接(可选;本站新建通常为空)。 */
  source?: string;
  /** 来源文字(可选)。 */
  sourceText?: string;
  /** 指定分组标题(可选);缺省时用「项目名 · 系统名」。 */
  group?: string;
  /** 系统名,用于拼分组标题。 */
  system?: string;
}

export type CreateResult =
  | { ok: true; group: string }
  | { ok: false; error: string };

export { existingGroups } from "./todo-format.js";

export function createTodo(todoPath: string, input: CreateInput): CreateResult {
  if (!existsSync(todoPath)) return { ok: false, error: "todo.md 不存在" };
  const nameError = todoNameError(input.name);
  if (nameError) return { ok: false, error: nameError };
  const name = input.name.trim();
  const progress = input.progress === undefined ? 0 : input.progress;
  if (!isTodoProgress(progress)) return { ok: false, error: "待办进度需为0–100的整数" };

  const text = readFileSync(todoPath, "utf-8").replace(/\r\n/g, "\n");
  const lines = text.split("\n");

  // 决定分组标题:显式指定 > 同项目已有分组 > 用项目名 + 系统名新建
  let group = input.group?.trim() || "";
  if (!group) {
    const exist = existingGroups(lines, input.projectName);
    const system = input.system || readProjectConfig(dirname(todoPath)).find((p) => p.name === input.projectName)?.system;
    group = exist[0] || (system ? `${input.projectName}${GROUP_SEP}${system}` : input.projectName);
  }

  // 创建100%时当次原子写就包含完成状态,不再以重名查找补写。
  const newLine = withTodoProgress(buildTodoLine({
    name,
    note: input.note,
    priority: input.priority,
    progress,
    start: input.start,
    due: input.due,
    type: input.type,
    source: input.source,
    sourceText: input.sourceText,
  }), progress, input.stamp ?? todoStamp());

  // 定位「## 未完成」区
  const openIdx = lines.findIndex((l) => l.trim().startsWith("## 未完成"));
  if (openIdx < 0) return { ok: false, error: "未找到「## 未完成」区" };
  const doneIdx = lines.findIndex((l, i) => i > openIdx && l.trim().startsWith("## 已完成"));
  const openEnd = doneIdx < 0 ? lines.length : doneIdx;

  // 在该区的分组标题下找插入点:该分组的最后一个待办行(含其子块)之后
  let groupIdx = -1;
  for (let i = openIdx + 1; i < openEnd; i++) {
    if (lines[i].trim() === `### ${group}`) {
      groupIdx = i;
      break;
    }
  }

  if (groupIdx < 0) {
    // 分组不存在:在未完成区末尾新建分组标题 + 待办
    const insertAt = stripTrailingBlanks(lines, openIdx + 1, openEnd);
    const block = ["", `### ${group}`, "", newLine];
    lines.splice(insertAt, 0, ...block);
  } else {
    // 分组已存在:找到该分组内最后一条待办(及其子块)的末尾
    let last = groupIdx;
    for (let i = groupIdx + 1; i < openEnd; i++) {
      const t = lines[i].trim();
      if (t.startsWith("### ") || t.startsWith("## ")) break;
      if (!isIndented(lines[i]) && parseTodoLine(lines[i])) last = i;
      else if (isIndented(lines[i]) && last > groupIdx) last = i;
    }
    lines.splice(last + 1, 0, newLine);
  }

  atomicWrite(todoPath, lines.join("\n"));
  return { ok: true, group };
}

/** 从 end 往回跳过空行,得到可插入位置(保持区尾整洁)。 */
function stripTrailingBlanks(lines: string[], start: number, end: number): number {
  let i = end;
  while (i > start && lines[i - 1].trim() === "") i--;
  return i;
}