/**
 * todo.md 的受限写入:勾选完成 + 写入完成情况子块。
 *
 * 这是本站的写路径之一,刻意保持最小与安全:
 * - 只翻转目标行的 `- [ ]` -> `- [x]`,可选在其下追加缩进的完成情况子块;
 * - 不改动其他任何行、不搬移分节;
 * - 原子写(临时文件 + rename),避免半截文件被读到;
 * - 字段分隔符一律全角冒号(见 todo-format.ts)。
 */

import { existsSync, readFileSync, writeFileSync, renameSync, copyFileSync } from "node:fs";
import { dirname } from "node:path";
import { readProjectConfig } from "./projects.js";
import {
  parseTodoLine,
  buildCompletionLines,
  buildFeedbackLines,
  buildTodoLine,
  existingGroups,
  isIndented,
  NOTE_SEP,
  COLON,
  SUBFIELD_RE,
  IMG_RE,
  FIELD,
  isTodoProgress,
  type TodoCompletion,
  type TodoFeedback,
} from "./todo-format.js";

/** 定位待办主行的下标(-1 表示未找到)。name 必填,source 可选(有则一起校验)。 */
export function findTodoLine(lines: string[], name: string, source: string): number {
  // 有来源时精确匹配;空来源优先定位明确的本站新建项,仅唯一同名时保留CLI省略来源的兼容。
  const hits: { index: number; source: string }[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (isIndented(lines[i])) continue;
    const p = parseTodoLine(lines[i]);
    if (p?.name === name) hits.push({ index: i, source: p.source });
  }
  const exact = hits.filter((hit) => hit.source === source);
  if (exact.length === 1) return exact[0].index;
  if (exact.length > 1 || source || hits.length !== 1) return -1;
  return hits[0].index;
}

/** 主字段的最早管道边界(只匹配权威字段,不把说明中的普通冒号当字段)。 */
function mainFieldOffset(line: string): number {
  const labels = [FIELD.priority, FIELD.progress, FIELD.start, FIELD.due, FIELD.type, FIELD.source];
  const m = line.match(new RegExp(`\\|\\s*(?:${labels.join("|")})${COLON}`));
  return m?.index ?? -1;
}

/** 待办完成时间戳(本地 YYYY-MM-DD HH:MM)。 */
export function todoStamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * 同步一条主行的进度、勾选与完成时间;只改主字段,不会触碰缩进子块。
 * 创建、编辑、完成与重开共用,避免不同入口状态漂移。
 */
export function withTodoProgress(line: string, progress: number, stamp = todoStamp()): string {
  if (!isTodoProgress(progress)) throw new Error("待办进度需为0–100的整数");
  const before = parseTodoLine(line);
  if (!before) throw new Error("待办主行格式不合法");
  let next = line;
  if (progress === 100) {
    if (!before.checked) next = stampDone(next, stamp);
  } else {
    next = next.replace(/^(\s*-\s*)\[[xX]\]/, "$1[ ]");
    next = next.replace(/\s*\*\*已于[^*]+完成\*\*/g, "");
  }

  const field = `| ${FIELD.progress}${COLON}${progress}`;
  const re = new RegExp(`\\|\\s*${FIELD.progress}${COLON}[^|]*`);
  if (re.test(next)) return next.replace(re, field + " ").trimEnd();

  // 缺省字段插在优先级后,或全部主字段之前;历史正文/来源原样保留。
  const priority = next.match(new RegExp(`\\|\\s*${FIELD.priority}${COLON}\\S+`));
  const at = priority ? priority.index! + priority[0].length : mainFieldOffset(next);
  if (at < 0) return `${next.trimEnd()} ${field}`;
  return `${next.slice(0, at).trimEnd()} ${field} ${next.slice(at).trimStart()}`.trimEnd();
}

/** 该主行之后已有的缩进子行区间 [start, end)。 */
function subRange(lines: string[], idx: number): [number, number] {
  let end = idx + 1;
  while (end < lines.length && isIndented(lines[end])) end++;
  return [idx + 1, end];
}

/**
 * 勾选完成并写入完成标记。
 * 关键:完成标记必须落在 **note 段**(`——` 之后),否则会被解析器当成事项名的一部分。
 * 若原行没有 `——`,则补一个 note 分隔符再放标记。
 * stamp 为完整完成时间戳(`YYYY-MM-DD HH:MM`,本地时间),由调用方生成。
 */
function stampDone(line: string, stamp: string): string {
  const marker = `**已于 ${stamp} 完成**`;
  let flipped = line;
  const m = flipped.match(/^(\s*-\s*)\[\s\]/);
  if (m) flipped = flipped.replace(/^(\s*-\s*)\[\s\]/, "$1[x]");

  // 以全部主字段中最早的管道边界拆分正文,避免完成标记黏到进度或日期上。
  let tail = "";
  const tailIdx = mainFieldOffset(flipped);
  let body = flipped;
  if (tailIdx >= 0) {
    body = flipped.slice(0, tailIdx).replace(/\s+$/, "");
    tail = " " + flipped.slice(tailIdx);
  }

  // 确保 body 里存在 note 分隔符,标记追加到 note 末尾
  if (body.includes(NOTE_SEP)) {
    body = `${body}${marker}`;
  } else {
    body = `${body} ${NOTE_SEP} ${marker}`;
  }
  return body + tail;
}

export type MarkResult = "done" | "already" | "notfound";

/**
 * 将匹配 name + source 的事项标记为已完成,可选写入完成情况。
 * completion.images 的 src 由调用方给出为**相对于仓库根**的路径(如
 * `projects/example/daily/2026-10/2026-10-14/attachments/1430-01.png`)。
 * stamp 为完整完成时间戳(`YYYY-MM-DD HH:MM`,本地时间)。
 */
export function markTodoDone(
  todoPath: string,
  name: string,
  source: string,
  stamp: string,
  completion?: TodoCompletion,
): MarkResult {
  if (!existsSync(todoPath)) return "notfound";
  const text = readFileSync(todoPath, "utf-8").replace(/\r\n/g, "\n");
  const lines = text.split("\n");

  const hit = findTodoLine(lines, name, source);
  if (hit < 0) return "notfound";

  const before = parseTodoLine(lines[hit])!;
  const alreadyChecked = before.checked;

  // 已完成项也补齐进度100,但保留原完成时间;不重复加标记。
  lines[hit] = withTodoProgress(lines[hit], 100, stamp);

  if (completion && (completion.text.trim() || completion.images.length)) {
    const [s, e] = subRange(lines, hit);
    const block = buildCompletionLines(completion);
    // 反馈子块(A-完成情况之前的历史反馈)原样保留:从第一个反馈行起到子块末尾
    const sub = lines.slice(s, e);
    const fbStart = sub.findIndex((l) => isFeedbackLine(l));
    const kept = fbStart >= 0 ? sub.slice(fbStart) : [];
    if (block.length) {
      lines.splice(s, e - s, ...block, ...kept);
    }
  }

  atomicWrite(todoPath, lines.join("\n"));
  return alreadyChecked ? "already" : "done";
}

/** 判断某缩进行是否为反馈子块(反馈行或它下面的图片行)。 */
function isFeedbackLine(line: string): boolean {
  const m = line.trim().match(SUBFIELD_RE);
  if (m) return m[1].trim() === FIELD.feedback;
  return false;
}

/**
 * 在条目既有子块**末尾追加**一条反馈(不动完成情况、不动历史反馈)。
 */
export function appendFeedback(
  todoPath: string,
  name: string,
  source: string,
  fb: TodoFeedback,
): "ok" | "notfound" {
  if (!existsSync(todoPath)) return "notfound";
  const text = readFileSync(todoPath, "utf-8").replace(/\r\n/g, "\n");
  const lines = text.split("\n");

  const hit = findTodoLine(lines, name, source);
  if (hit < 0) return "notfound";

  const [, e] = subRange(lines, hit);
  lines.splice(e, 0, ...buildFeedbackLines(fb));

  atomicWrite(todoPath, lines.join("\n"));
  return "ok";
}

/** 原子写:先备份再写临时文件,最后 rename。 */
export function atomicWrite(path: string, content: string): void {
  if (existsSync(path)) copyFileSync(path, `${path}.bak`);
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, content, "utf-8");
  renameSync(tmp, path);
}

/**
 * 为第 fbIndex 条反馈设置回复(0 起)。已有回复则整体替换。
 * 回复身份固定为「管理员」,时间为调用方给出。
 */
export function setFeedbackReply(
  todoPath: string,
  name: string,
  source: string,
  fbIndex: number,
  reply: { by: string; at: string; text: string; images: { alt: string; src: string }[] },
): "ok" | "notfound" | "outofrange" {
  if (!existsSync(todoPath)) return "notfound";
  const text = readFileSync(todoPath, "utf-8").replace(/\r\n/g, "\n");
  const lines = text.split("\n");

  const hit = findTodoLine(lines, name, source);
  if (hit < 0) return "notfound";

  // 子块区间内定位各条反馈的起始行
  const [s, e] = subRange(lines, hit);
  const fbStarts: number[] = [];
  for (let i = s; i < e; i++) {
    const m = lines[i].trim().match(SUBFIELD_RE);
    if (m && m[1].trim() === FIELD.feedback) fbStarts.push(i);
  }
  if (fbIndex < 0 || fbIndex >= fbStarts.length) return "outofrange";

  // 该反馈的区间:从其起始行到下一条反馈(或子块末尾)
  const start = fbStarts[fbIndex];
  const end = fbIndex + 1 < fbStarts.length ? fbStarts[fbIndex + 1] : e;

  // 区间内移除旧回复行(含其图片),保留反馈本身
  const kept: string[] = [];
  let inOldReply = false;
  for (let i = start; i < end; i++) {
    const m = lines[i].trim().match(SUBFIELD_RE);
    if (m && m[1].trim() === FIELD.reply) { inOldReply = true; continue; }
    if (inOldReply) {
      const im = lines[i].match(IMG_RE);
      if (im) continue; // 旧回复的图片行
      if (lines[i].trim() === "") { continue; }
      inOldReply = false;
    }
    kept.push(lines[i]);
  }

  // 回复子块(4 空格缩进,属于该反馈):buildFeedbackLines 已生成正确层级
  const built = buildFeedbackLines({ by: "", at: "", text: "", images: [], reply });
  const replyIdx = built.findIndex((l) => l.trim().startsWith(`- **${FIELD.reply}**`));
  const replyLines = replyIdx >= 0 ? built.slice(replyIdx) : [];

  lines.splice(start, end - start, ...kept, ...replyLines);
  atomicWrite(todoPath, lines.join("\n"));
  return "ok";
}

export type UndoneResult = "undone" | "already" | "notfound";

/**
 * 取消完成:`- [x]` 翻回 `- [ ]`,去掉行内「**已于 … 完成**」标记。
 * 完成情况子块、反馈与回复**原样保留**(历史不删),仅状态回退。
 */
export function markTodoUndone(
  todoPath: string,
  name: string,
  source: string,
): UndoneResult {
  if (!existsSync(todoPath)) return "notfound";
  const text = readFileSync(todoPath, "utf-8").replace(/\r\n/g, "\n");
  const lines = text.split("\n");

  const hit = findTodoLine(lines, name, source);
  if (hit < 0) return "notfound";
  const before = parseTodoLine(lines[hit])!;
  if (!before.checked) return "already";

  // 取消完成同时重置进度0,完成情况/反馈等历史子块原样保留。
  lines[hit] = withTodoProgress(lines[hit], 0);

  atomicWrite(todoPath, lines.join("\n"));
  return "undone";
}

/**
 * 删除待办及其下属所有子行(完成情况、附件、反馈、回复)。
 */
export function deleteTodo(
  todoPath: string,
  name: string,
  source: string,
): "ok" | "notfound" {
  if (!existsSync(todoPath)) return "notfound";
  const text = readFileSync(todoPath, "utf-8").replace(/\r\n/g, "\n");
  const lines = text.split("\n");

  const hit = findTodoLine(lines, name, source);
  if (hit < 0) return "notfound";

  const [, e] = subRange(lines, hit);
  lines.splice(hit, e - hit);

  atomicWrite(todoPath, lines.join("\n"));
  return "ok";
}

export interface UpdateTodoPatch {
  name?: string;
  note?: string;
  priority?: string;
  progress?: number;
  start?: string;
  due?: string;
  type?: string;
  project?: string;
  group?: string;
}

/**
 * 编辑待办:修改事项名、说明、优先级、类型、归属项目/分组。
 * 完整保留或继承原有的勾选状态、完成时间戳、完成情况与用户反馈子块。
 */
export function updateTodo(
  todoPath: string,
  name: string,
  source: string,
  patch: UpdateTodoPatch,
  stamp = todoStamp(),
): "ok" | "notfound" {
  if (patch.progress !== undefined && !isTodoProgress(patch.progress)) {
    throw new Error("待办进度需为0–100的整数");
  }
  if (!existsSync(todoPath)) return "notfound";
  const text = readFileSync(todoPath, "utf-8").replace(/\r\n/g, "\n");
  const lines = text.split("\n");

  const hit = findTodoLine(lines, name, source);
  if (hit < 0) return "notfound";

  const before = parseTodoLine(lines[hit])!;
  const [s, e] = subRange(lines, hit);
  const subLines = lines.slice(s, e);

  const newProgress = patch.progress !== undefined ? patch.progress : before.progress;
  const checked = newProgress === 100;

  // 保留原完成时间;降低进度时仅移除行内完成标记,历史子块不动。
  let newNote = patch.note !== undefined ? patch.note : before.note;
  if (before.checked && checked) {
    const doneMarkerMatch = lines[hit].match(/\*\*已于[^\*]+完成\*\*/);
    if (doneMarkerMatch && (!newNote || !newNote.includes(doneMarkerMatch[0]))) {
      newNote = newNote ? `${newNote.trim()} ${doneMarkerMatch[0]}` : doneMarkerMatch[0];
    }
  }

  // 2. 构造新的主待办行
  const newName = patch.name?.trim() ? patch.name.trim() : before.name;
  const newPriority = patch.priority !== undefined ? patch.priority : before.priority;
  const newStart = patch.start !== undefined ? patch.start : before.start;
  const newDue = patch.due !== undefined ? patch.due : before.due;
  const newType = patch.type !== undefined ? patch.type : before.type;
  let newLine = buildTodoLine({
    name: newName,
    note: newNote,
    priority: newPriority,
    progress: newProgress,
    start: newStart,
    due: newDue,
    type: newType,
    source: before.source,
    sourceText: before.sourceText,
  });
  if (before.checked) {
    newLine = newLine.replace(/^(\s*-\s*)\[\s\]/, "$1[x]");
  }
  newLine = withTodoProgress(newLine, newProgress, stamp);

  // 3. 检查是否需要跨分组移动
  let targetGroup = patch.group?.trim() || "";
  if (!targetGroup && patch.project) {
    const exist = existingGroups(lines, patch.project);
    const system = readProjectConfig(dirname(todoPath)).find((p) => p.name === patch.project)?.system;
    targetGroup = exist[0] || (system ? `${patch.project} · ${system}` : patch.project);
  }

  let currentGroup = "";
  for (let i = hit; i >= 0; i--) {
    if (lines[i].trim().startsWith("### ")) {
      currentGroup = lines[i].trim().slice(4).trim();
      break;
    }
  }

  if (!targetGroup || targetGroup === currentGroup) {
    lines[hit] = newLine;
    atomicWrite(todoPath, lines.join("\n"));
    return "ok";
  }

  // 需要跨组平移: 抽取主行及下属子行
  const fullBlock = [newLine, ...subLines];
  lines.splice(hit, e - hit);

  // 在目标分组中寻找位置
  const openIdx = lines.findIndex((l) => l.trim().startsWith("## 未完成"));
  const doneIdx = lines.findIndex((l, i) => i > openIdx && l.trim().startsWith("## 已完成"));
  const searchStart = checked ? (doneIdx < 0 ? 0 : doneIdx) : (openIdx < 0 ? 0 : openIdx);
  const searchEnd = checked ? lines.length : (doneIdx < 0 ? lines.length : doneIdx);

  let groupIdx = -1;
  for (let i = searchStart; i < searchEnd; i++) {
    if (lines[i].trim() === `### ${targetGroup}`) {
      groupIdx = i;
      break;
    }
  }

  if (groupIdx < 0) {
    const block = ["", `### ${targetGroup}`, "", ...fullBlock];
    lines.splice(searchEnd, 0, ...block);
  } else {
    let last = groupIdx;
    for (let i = groupIdx + 1; i < searchEnd; i++) {
      const t = lines[i].trim();
      if (t.startsWith("### ") || t.startsWith("## ")) break;
      if (!isIndented(lines[i]) && parseTodoLine(lines[i])) last = i;
      else if (isIndented(lines[i]) && last > groupIdx) last = i;
    }
    lines.splice(last + 1, 0, ...fullBlock);
  }

  atomicWrite(todoPath, lines.join("\n"));
  return "ok";
}
