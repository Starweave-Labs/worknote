/**
 * WorkNote 写入 CLI —— 面向助手的一次性写入 / 全库校验 / 完成标记 / 概要起草。
 *
 * 四个子命令,把「写当日文件 + 存附件 + 更新 index.md + 落位 todo.md」收进一次调用,
 * 格式全部复用权威模块(todo-format 的常量与生成器、todo-write 的原子写),
 * 写完自动校验,失败非零退出——消灭多文件同步的往返与静默格式错误。
 * add 写入后还会输出「关联记忆」(同项目同模块的历史条目与未完成待办),
 * 供助手在汇报/去重时带上前情;summary 用 AI 按当日条目起草概要。
 *
 * 用法:
 *   node dist/record.js add     [--file in.json | stdin] [--dry-run]
 *   node dist/record.js check   [--json]
 *   node dist/record.js done    <事项名> [--source 路径#锚点] [--note 完成情况]
 *                               [--images a.png,b.png] [--at "YYYY-MM-DD HH:MM"] [--no-daylog]
 *   node dist/record.js summary [--date YYYY-MM-DD] [--project <slug|名>] [--dry-run]
 *
 * add 的 JSON 结构见 usage()。done/summary 的图片会先归档进对应项目当日 attachments/。
 * 子命令共用 environment.ts 的私有数据根与显式环境配置。
 */

import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { dataRoot } from "./environment.js";
import { getProjectNames, readProjectConfig } from "./projects.js";
import {
  TYPE_ORDER,
  collect,
  parseTodo,
  slug,
} from "./parser.js";
import {
  CHECKBOX_RE,
  COLON,
  FIELD,
  GROUP_SEP,
  IMG_RE,
  SUBFIELD_RE,
  isIndented,
  isTodoProgress,
  parseTodoLine,
  type TodoCompletion,
} from "./todo-format.js";
import { appendDayCompletion, dayFilePath, type DayEntryInput } from "./daylog-write.js";
import { createTodo } from "./todo-create.js";
import { atomicWrite, findTodoLine, markTodoDone, type MarkResult } from "./todo-write.js";
import { loadWorknoteEnv } from "./notify.js";

/* ---------------- 基础工具 ---------------- */

const ROOT = dataRoot();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;
const VALID_TYPES = new Set<string>(TYPE_ORDER);

function fail(msg: string): never {
  console.error(`✖ ${msg}`);
  process.exit(1);
}

function usage(): void {
  console.log(`WorkNote 写入 CLI

子命令:
  add     一次性写入(当日记录 + 附件 + index.md 摘要 + 待办落位),JSON 走 --file 或 stdin;
          输出含 related(同项目同模块历史条目 + 该项目未完成待办,供关联记忆)
  check   全库格式校验(记录字段/附件存在性/todo 格式与来源锚点/index 链接),--json 机读
  done    勾选待办完成(写完成标记与完成情况,默认同步追加当日记录)
  summary 用 AI 按当日条目起草一句话概要,写回当日文件与 index(需配置 AI)

add 输入示例:
  {
    "project": "example",                 // projects.json 中的项目 slug 或名称(必填)
    "date": "2026-10-21",                 // YYYY-MM-DD(必填)
    "system": "示例系统",                 // 缺省用登记的默认系统
    "summary": "一句话概要",               // 可选:更新当日概要与 index 摘要
    "entries": [{
      "time": "14:30", "title": "条目标题", "type": "需求", "module": "科研项目管理",
      "content": "做了什么", "problem": "现象", "requirement": "期望改动",
      "progress": "当前状态", "todoNote": "后续要做的事",
      "extra": { "字段名": "值" },          // 可选:模板字段之外的自定义字段(按给定顺序)
      "images": [{ "alt": "说明", "src": "/绝对路径/或相对cwd.png" }]
    }],
    "todos": [{                            // 可选:同步落位到 todo.md
      "name": "事项名", "note": "说明", "priority": "高", "type": "需求",
      "system": "示例系统",                // 可选:分组第二段,缺省沿用同项目已有分组
      "entryIndex": 0,                     // 可选:来源链接指向 entries[i]
      "progress": 100,                     // 可选:0..100 整数,100 已完成;缺省未完成 0
      "done": true,                        // 可选:未给 progress 时,true 用 100;不可与进度矛盾
      "doneNote": "完成情况", "doneImages": [{ "alt": "截图", "src": "..." }]
    }],
    "doneAt": "2026-10-21 14:30"           // 可选:done 待办的完成时间,缺省当前时间
  }

done 示例:
  node dist/record.js done "排查标准台账无数据的原因" --note "已修复" --images /tmp/a.png

summary 示例:
  node dist/record.js summary                 # 起草今天全部项目的概要
  node dist/record.js summary --date 2026-10-20 --project example --dry-run`);
}

/* ---------------- add:输入类型 ---------------- */

interface SrcImage {
  alt?: string;
  /** 源文件绝对路径(或相对 cwd)。 */
  src: string;
}

interface AddEntryInput {
  time: string;
  title: string;
  type: string;
  module?: string;
  content?: string;
  problem?: string;
  requirement?: string;
  progress?: string;
  todoNote?: string;
  extra?: Record<string, string>;
  images?: SrcImage[];
}

interface AddTodoInput {
  name: string;
  note?: string;
  priority?: string;
  start?: string;
  due?: string;
  type?: string;
  system?: string;
  entryIndex?: number;
  /** 待办数字进度,不同于 entries[].progress 的「进展」正文。 */
  progress?: number;
  done?: boolean;
  doneNote?: string;
  doneImages?: SrcImage[];
}

interface AddInput {
  project: string;
  date: string;
  system?: string;
  summary?: string;
  entries: AddEntryInput[];
  todos?: AddTodoInput[];
  doneAt?: string;
}

/* ---------------- add:实现 ---------------- */

/** 复制附件进当日 attachments/,按 HHMM-序号 命名,chmod 644。返回记录内相对路径。 */
function archiveImage(root: string, slugName: string, date: string, hhmm: string, seq: number, src: string): string {
  const abs = isAbsolute(src) ? src : resolve(process.cwd(), src);
  if (!existsSync(abs)) fail(`附件源文件不存在: ${abs}`);
  const ext = extname(abs).toLowerCase() || ".png";
  const dir = join(root, "projects", slugName, "daily", date.slice(0, 7), date, "attachments");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o755 });
  // 目标已存在则顺延序号,绝不覆盖既有附件(曾因同 HHMM 多条目各自从 01 编号而互相覆盖)
  let name = `${hhmm}-${String(seq).padStart(2, "0")}${ext}`;
  let dst = join(dir, name);
  while (existsSync(dst)) {
    seq += 1;
    name = `${hhmm}-${String(seq).padStart(2, "0")}${ext}`;
    dst = join(dir, name);
  }
  copyFileSync(abs, dst);
  chmodSync(dst, 0o644);
  return `attachments/${name}`;
}

/** 组装一条记录条目的 Markdown(字段顺序与当日模板一致)。 */
function buildDayEntryMarkdown(e: AddEntryInput, imageRefs: { alt: string; ref: string }[]): string {
  const lines: string[] = [];
  lines.push(`## ${e.time} ${e.title}`, "");
  lines.push(`- **类型**${COLON}${e.type}`);
  if (e.module) lines.push(`- **模块**${COLON}${e.module}`);
  if (e.content) lines.push(`- **内容**${COLON}${e.content}`);
  if (e.problem) lines.push(`- **问题**${COLON}${e.problem}`);
  if (e.requirement) lines.push(`- **需求**${COLON}${e.requirement}`);
  if (e.progress) lines.push(`- **进展**${COLON}${e.progress}`);
  if (e.todoNote) lines.push(`- **待办**${COLON}${e.todoNote}`);
  if (e.extra) {
    for (const [k, v] of Object.entries(e.extra)) {
      if (v !== undefined && v !== "") lines.push(`- **${k}**${COLON}${v}`);
    }
  }
  if (imageRefs.length) {
    lines.push(`- **附件**${COLON}`, "");
    for (const im of imageRefs) {
      lines.push(`  ![${im.alt || "图片说明"}](${im.ref})`, "");
    }
  }
  lines.push("", "");
  return lines.join("\n");
}

/** 追加条目到当日文件;文件不存在则按模板新建。 */
function appendDayEntry(root: string, slugName: string, date: string, projectName: string, systemName: string, entryMd: string): void {
  const file = dayFilePath(root, slugName, date);
  if (!existsSync(file)) {
    const tpl =
      `# ${date} 工作记录\n\n` +
      `- **项目**${COLON}${projectName}\n` +
      `- **系统**${COLON}${systemName}\n\n` +
      `> 概要${COLON}\n\n` +
      entryMd +
      `---\n`;
    atomicWrite(file, tpl);
    return;
  }
  const text = readFileSync(file, "utf-8").replace(/\r\n/g, "\n");
  const trimmed = text.replace(/\s+$/, "\n");
  const hadSep = /\n---\s*$/.test(trimmed);
  const body = hadSep ? trimmed.replace(/\n---\s*$/, "\n") : trimmed;
  const prefix = body.endsWith("\n\n") ? body : body.endsWith("\n") ? `${body}\n` : `${body}\n\n`;
  atomicWrite(file, `${prefix}${entryMd}---\n`);
}

/** 更新/补全当日文件的 `> 概要：` 行。 */
function updateDaySummary(root: string, slugName: string, date: string, summary: string): void {
  const file = dayFilePath(root, slugName, date);
  if (!existsSync(file)) return;
  const text = readFileSync(file, "utf-8").replace(/\r\n/g, "\n");
  const replaced = text.replace(/^>\s*概要[：:].*$/m, `> 概要${COLON}${summary}`);
  if (replaced !== text) atomicWrite(file, replaced);
}

/** index.md:登记/更新某日摘要(项目节与月份节缺失时创建,日期倒序插入)。 */
function updateIndex(root: string, slugName: string, projectName: string, systemName: string, date: string, summary: string): void {
  const file = join(root, "index.md");
  if (!existsSync(file)) fail("index.md 不存在");
  let lines = readFileSync(file, "utf-8").replace(/\r\n/g, "\n").split("\n");
  const link = `- [${date}](projects/${slugName}/daily/${date.slice(0, 7)}/${date}/${date}.md) — ${summary}`;

  // 定位项目节
  let projIdx = lines.findIndex((l) => l.trim() === `## ${projectName}`);
  if (projIdx < 0) {
    // 新项目节追加到文件末尾
    while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
    lines.push("", `## ${projectName}`, "", `- 系统${COLON}${systemName}`, `- 目录${COLON}[projects/${slugName}](projects/${slugName}/)`, "", `### ${date.slice(0, 7)}`, "", link, "");
    atomicWrite(file, lines.join("\n"));
    return;
  }
  // 项目节范围
  let projEnd = lines.length;
  for (let i = projIdx + 1; i < lines.length; i++) {
    if (lines[i].trim().startsWith("## ")) { projEnd = i; break; }
  }

  const month = date.slice(0, 7);
  // 已有该日链接行 → 更新摘要
  const dayLineIdx = lines.findIndex((l, i) => i > projIdx && i < projEnd && l.trim().startsWith(`- [${date}](`));
  if (dayLineIdx >= 0) {
    lines[dayLineIdx] = link;
    atomicWrite(file, lines.join("\n"));
    return;
  }
  // 定位月份节
  let monthIdx = -1;
  for (let i = projIdx + 1; i < projEnd; i++) {
    const m = lines[i].trim().match(/^### (\d{4}-\d{2})$/);
    if (m && m[1] === month) { monthIdx = i; break; }
  }
  if (monthIdx < 0) {
    // 新月份节:插在项目节内(月份倒序——比现有月份小则放末尾,否则放最前)
    let insertAt = projEnd;
    for (let i = projIdx + 1; i < projEnd; i++) {
      const m = lines[i].trim().match(/^### (\d{4}-\d{2})$/);
      if (m && m[1] < month) { insertAt = i; break; }
    }
    const block = [`### ${month}`, "", link, ""];
    lines.splice(insertAt, 0, ...block);
    atomicWrite(file, lines.join("\n"));
    return;
  }
  // 月份节内:日期倒序插入
  let insertAt = monthIdx + 1;
  for (let i = monthIdx + 1; i < projEnd; i++) {
    const m = lines[i].trim().match(/^- \[(\d{4}-\d{2}-\d{2})\]\(/);
    if (m && m[1] < date) { insertAt = i; break; }
    if (lines[i].trim().startsWith("### ") && i > monthIdx + 1) { insertAt = i; break; }
  }
  lines.splice(insertAt, 0, link);
  atomicWrite(file, lines.join("\n"));
}

/**
 * 关联记忆:add 写入后供助手带上前情——同项目同模块的历史条目(最近 5 条)
 * 与该项目当前未完成待办(最多 5 条)。失败不影响写入,返回空。
 */
function relatedMemory(input: AddInput): {
  entries: { date: string; time: string; title: string; path: string }[];
  openTodos: { name: string; due: string; group: string; progress: number }[];
} {
  const out = { entries: [] as { date: string; time: string; title: string; path: string }[], openTodos: [] as { name: string; due: string; group: string; progress: number }[] };
  try {
    const p = collect(ROOT).find((x) => x.slug === input.project);
    if (!p) return out;
    const modules = new Set(input.entries.map((e) => e.module?.trim()).filter(Boolean) as string[]);
    for (const d of p.days) {
      if (d.date === input.date) continue; // 本次刚写的不算“前情”
      for (const e of d.entries) {
        if (modules.size && e.module && modules.has(e.module)) {
          out.entries.push({
            date: d.date,
            time: e.time,
            title: e.title,
            path: `projects/${p.slug}/daily/${d.month}/${d.date}/${d.date}.md#${e.anchor}`,
          });
        }
      }
    }
    out.entries.sort((a, b) => (a.date < b.date ? 1 : -1));
    out.entries = out.entries.slice(0, 5);
    out.openTodos = parseTodo(join(ROOT, "todo.md"))
      .open.filter((t) => t.group.startsWith(p.name))
      .slice(0, 5)
      .map((t) => ({ name: t.name, due: t.due, group: t.group, progress: t.progress }));
  } catch {
    /* 关联记忆是增值信息,失败静默 */
  }
  return out;
}

/** add 主流程。 */
function cmdAdd(argv: string[]): void {
  let dryRun = false;
  let raw = "";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--dry-run") dryRun = true;
    else if (argv[i] === "--file") {
      const p = argv[++i];
      if (!p) fail("--file 缺少路径");
      raw = readFileSync(isAbsolute(p) ? p : resolve(process.cwd(), p), "utf-8");
    } else fail(`add 不认识的参数: ${argv[i]}`);
  }
  if (!raw.trim()) raw = readFileSync(0, "utf-8"); // stdin
  let input: AddInput;
  try {
    input = JSON.parse(raw) as AddInput;
  } catch (e) {
    fail(`JSON 解析失败: ${e instanceof Error ? e.message : e}`);
  }

  // ---- 校验输入 ----
  const project = readProjectConfig(ROOT).find((p) => p.slug === input.project || p.name === input.project);
  if (!project) {
    fail(`未知项目: ${input.project}(请先在数据目录 projects.json 登记 slug/name)`);
  }
  input.project = project.slug;
  const projectName = project.name;
  if (!input.date || !DATE_RE.test(input.date)) fail(`date 需为 YYYY-MM-DD: ${input.date}`);
  if (!Array.isArray(input.entries) || !input.entries.length) fail("entries 至少一条");
  for (const e of input.entries) {
    if (!TIME_RE.test(e.time)) fail(`条目 time 需为 HH:MM: ${e.time}`);
    if (!e.title?.trim()) fail("条目 title 不能为空");
    if (!VALID_TYPES.has(e.type)) fail(`条目 type 需为 ${TYPE_ORDER.join("|")}: ${e.type}`);
  }
  const systemName = input.system?.trim() || project.system || systemOf(project.slug);
  const doneAt = input.doneAt?.trim() || "";
  if (doneAt && !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(doneAt)) fail(`doneAt 需为 "YYYY-MM-DD HH:MM": ${doneAt}`);
  if (input.todos !== undefined && !Array.isArray(input.todos)) fail("todos 必须为数组");
  // 先规范化全部待办,任何非法进度或 done 冲突都在附件/记录等写入之前拒绝。
  // entries[].progress 是「进展」正文字符串,与这里的数字进度无关。
  const todos = (input.todos ?? []).map((t) => {
    if (!t.name?.trim()) fail("todos[].name 不能为空");
    if (t.type && !VALID_TYPES.has(t.type)) fail(`todos[].type 需为 ${TYPE_ORDER.join("|")}: ${t.type}`);
    if (t.due && !/^\d{4}-\d{2}-\d{2}$/.test(t.due)) fail(`todos[].due 需为 YYYY-MM-DD: ${t.due}`);
    if (t.entryIndex !== undefined && (!Number.isInteger(t.entryIndex) || t.entryIndex < 0 || t.entryIndex >= input.entries.length)) {
      fail(`todos[].entryIndex 越界: ${t.entryIndex}`);
    }
    if (t.progress !== undefined && !isTodoProgress(t.progress)) {
      fail(`todos[].progress 需为 0..100 整数: ${String(t.progress)}`);
    }
    if (t.done !== undefined && typeof t.done !== "boolean") fail("todos[].done 需为 boolean");
    const progress = t.progress ?? (t.done === true ? 100 : 0);
    if (t.done === true && progress < 100) fail(`待办「${t.name}」done:true 与 progress:${progress} 冲突`);
    if (t.done === false && progress === 100) fail(`待办「${t.name}」done:false 与 progress:100 冲突`);
    return { ...t, progress, done: progress === 100 };
  });

  const slugName = input.project;
  const dayRel = `projects/${slugName}/daily/${input.date.slice(0, 7)}/${input.date}/${input.date}.md`;

  // ---- 重复待办预检(同一事项只留一条) ----
  const existing = parseTodo(join(ROOT, "todo.md"));
  for (const t of todos) {
    if (existing.open.some((x) => x.name === t.name) || existing.done.some((x) => x.name === t.name)) {
      fail(`待办「${t.name}」已存在(未完成或已完成),请勿重复添加`);
    }
  }

  // ---- 干跑:只打印计划 ----
  if (dryRun) {
    console.log(JSON.stringify({
      dryRun: true,
      dayFile: dayRel,
      entries: input.entries.map((e) => ({ time: e.time, title: e.title, anchor: slug(`${e.time} ${e.title}`) })),
      todos: todos.map((t) => ({ name: t.name, progress: t.progress, done: t.done })),
      related: relatedMemory(input),
    }, null, 2));
    return;
  }

  // ---- 写入:附件 → 当日文件 → 概要 → index → todo ----
  const anchors: string[] = [];
  // 同 HHMM 的图片跨条目连续编号,避免不同条目都从 01 起而互相覆盖
  const seqByHHMM = new Map<string, number>();
  for (const e of input.entries) {
    const hhmm = e.time.replace(":", "");
    const imgRefs: { alt: string; ref: string }[] = [];
    for (const im of e.images ?? []) {
      const n = (seqByHHMM.get(hhmm) ?? 0) + 1;
      seqByHHMM.set(hhmm, n);
      imgRefs.push({ alt: im.alt || "", ref: archiveImage(ROOT, slugName, input.date, hhmm, n, im.src) });
    }
    const md = buildDayEntryMarkdown(e, imgRefs);
    appendDayEntry(ROOT, slugName, input.date, projectName, systemName, md);
    anchors.push(slug(`${e.time} ${e.title}`));
  }
  if (input.summary?.trim()) {
    updateDaySummary(ROOT, slugName, input.date, input.summary.trim());
    updateIndex(ROOT, slugName, projectName, systemName || systemOf(input.project), input.date, input.summary.trim());
  } else if (!existsIndexDay(slugName, input.date)) {
    // 无 summary 也要保证 index 有该日条目(摘要回退为首条标题)
    const fallback = input.entries[0].title.replace(/（[^）]*）$/, "");
    updateIndex(ROOT, slugName, projectName, systemName || systemOf(input.project), input.date, fallback);
  }

  const todoResults: { name: string; group: string; progress: number; done: MarkResult | "created" }[] = [];
  const stamp = doneAt || nowStamp();
  for (const t of todos) {
    const source = t.entryIndex !== undefined
      ? `${dayRel}#${anchors[t.entryIndex]}`
      : undefined;
    const sourceText = t.entryIndex !== undefined ? `${input.date} ${input.entries[t.entryIndex].time}` : undefined;
    const cr = createTodo(join(ROOT, "todo.md"), {
      projectName,
      name: t.name,
      note: t.note,
      priority: t.priority,
      start: t.start,
      due: t.due,
      type: t.type,
      source,
      sourceText,
      system: t.system || systemName || undefined,
      progress: t.progress,
      stamp,
    });
    if (!cr.ok) fail(`待办「${t.name}」写入失败: ${cr.error}`);
    if (t.done) {
      // createTodo 已在同次写入中完成 progress=100 的主行;继续补写完成说明/图片,
      // markTodoDone 返回 already 是正常结果。完成图片先归档(用 stamp 的 HHMM 命名)
      const hhmm = stamp.slice(11).replace(":", "");
      const imgs: { alt: string; src: string }[] = [];
      (t.doneImages ?? []).forEach((im, i) => {
        imgs.push({ alt: im.alt || "完成截图", src: `${dayRel.slice(0, dayRel.lastIndexOf("/") + 1)}${archiveImage(ROOT, slugName, input.date, hhmm, i + 1, im.src)}` });
      });
      const completion: TodoCompletion | undefined = t.doneNote || imgs.length
        ? { text: t.doneNote || "", images: imgs }
        : undefined;
      const mr = markTodoDone(join(ROOT, "todo.md"), t.name, source || "", stamp, completion);
      if (mr === "notfound") fail(`待办「${t.name}」标记完成失败: 未找到行`);
      todoResults.push({ name: t.name, group: cr.group, progress: t.progress, done: mr });
    } else {
      todoResults.push({ name: t.name, group: cr.group, progress: t.progress, done: "created" });
    }
  }

  console.log(JSON.stringify({
    ok: true,
    dayFile: dayRel,
    entries: input.entries.map((e, i) => ({
      time: e.time,
      title: e.title,
      anchor: anchors[i],
      path: `${dayRel}#${anchors[i]}`,
    })),
    summaryUpdated: !!input.summary?.trim(),
    todos: todoResults,
    related: relatedMemory(input),
    validation: validateAfterWrite(),
  }, null, 2));
}

/** 写入后的全库校验:有错误则打印并返回非零(把静默格式错误变成当场报错)。 */
function validateAfterWrite(): { errors: number; warnings: number } {
  const { errors, warnings } = checkAll();
  for (const e of errors) console.error(`✖ 校验: ${e}`);
  for (const w of warnings) console.error(`⚠ 校验: ${w}`);
  if (errors.length) {
    console.error(`✖ 写入后校验发现 ${errors.length} 个错误(写入已落盘,请检查上述位置)`);
    process.exit(1);
  }
  return { errors: 0, warnings: warnings.length };
}

function systemOf(slugName: string): string {
  try {
    const projects = collect(ROOT);
    const p = projects.find((x) => x.slug === slugName);
    return p?.systems[0] ?? "";
  } catch {
    return "";
  }
}

function existsIndexDay(slugName: string, date: string): boolean {
  try {
    const text = readFileSync(join(ROOT, "index.md"), "utf-8");
    return text.includes(`projects/${slugName}/daily/${date.slice(0, 7)}/${date}/${date}.md`);
  } catch {
    return false;
  }
}

function nowStamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/* ---------------- check:实现 ---------------- */

type Issues = { errors: string[]; warnings: string[] };

function checkAll(): Issues {
  const errors: string[] = [];
  const warnings: string[] = [];
  const dayAnchors = new Map<string, Set<string>>(); // 绝对路径 -> 锚点集合

  // ---- 每日记录 ----
  let projects: ReturnType<typeof collect> = [];
  try {
    projects = collect(ROOT);
  } catch (e) {
    errors.push(`collect() 解析失败: ${e instanceof Error ? e.message : e}`);
    return { errors, warnings };
  }
  for (const p of projects) {
    for (const d of p.days) {
      const file = join(ROOT, "projects", p.slug, "daily", d.month, d.date, `${d.date}.md`);
      const rel = relative(ROOT, file);
      if (!existsSync(file)) { errors.push(`${rel}: 文件缺失`); continue; }
      const raw = readFileSync(file, "utf-8").replace(/\r\n/g, "\n");
      if (!/^-\s*\*\*项目\*\*/m.test(raw)) errors.push(`${rel}: 缺少「- **项目**：」头行`);
      if (!/^-\s*\*\*系统\*\*/m.test(raw)) errors.push(`${rel}: 缺少「- **系统**：」头行`);
      if (!d.entries.length) warnings.push(`${rel}: 无任何条目`);

      dayAnchors.set(file, new Set(d.entries.map((e) => e.anchor)));

      // 半角冒号字段(应为全角):`- **xxx**: 值`,每文件报一次
      const badColon = raw.split("\n").find((line) => /^-\s*\*\*[^*]+\*\*:/.test(line));
      if (badColon) errors.push(`${rel}: 半角冒号字段行 → ${badColon.trim().slice(0, 40)}`);

      for (const e of d.entries) {
        const label = `${rel} [${e.time} ${e.title.slice(0, 20)}]`;
        if (!VALID_TYPES.has(e.type)) errors.push(`${label}: 类型「${e.type}」不在 ${TYPE_ORDER.join("/")}`);
        if (!e.module?.trim()) warnings.push(`${label}: 缺少模块`);
      }
      // 附件存在性(全文件扫图片引用)
      for (const m of raw.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)) {
        const src = m[1].trim();
        if (/^(https?:)?\/\//.test(src) || src.startsWith("data:")) continue;
        let abs = "";
        if (src.startsWith("attachments/")) abs = join(dirname(file), src);
        else if (src.startsWith("projects/")) abs = join(ROOT, src);
        else { warnings.push(`${rel}: 非常规附件路径 → ${src}`); continue; }
        if (!existsSync(abs)) errors.push(`${rel}: 附件不存在 → ${src}`);
      }
    }
  }

  // ---- todo.md ----
  const todoPath = join(ROOT, "todo.md");
  if (!existsSync(todoPath)) {
    errors.push("todo.md 不存在");
  } else {
    const raw = readFileSync(todoPath, "utf-8").replace(/\r\n/g, "\n");
    const lines = raw.split("\n");
    let curLabel = "todo.md";
    let subState: "main" | "completion" | "feedback" | "reply" = "main";
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      if (!trimmed) continue;

      // 主行
      const cm = trimmed.match(CHECKBOX_RE);
      if (cm && !isIndented(line)) {
        const parsed = parseTodoLine(line)!;
        curLabel = `todo.md:${i + 1}「${parsed.name.slice(0, 24)}」`;
        subState = "main";
        if (!parsed.name.trim()) errors.push(`todo.md:${i + 1}: 待办名称为空`);
        // 半角字段
        if (/\|\s*(优先级|预计开始|预计完成|进度|类型|来源):/.test(line)) {
          errors.push(`${curLabel}: 字段使用了半角冒号(应为全角)`);
        }
        // 直接检查原始字段,不能用解析器对历史缺省/已完成状态的归一化值掩盖格式错误。
        // 缺少进度字段的历史条目合法;显式字段不带百分号,且必须与复选框状态一致。
        const progressFields = [...line.matchAll(new RegExp(`\\|\\s*${FIELD.progress}${COLON}([^|]*)`, "g"))];
        if (progressFields.length > 1) errors.push(`${curLabel}: 进度字段重复`);
        for (const field of progressFields) {
          const value = field[1].trim();
          const progress = Number(value);
          if (!/^\d+$/.test(value) || !isTodoProgress(progress)) {
            errors.push(`${curLabel}: 显式进度「${value}」需为 0..100 整数(不带%)`);
          } else if ((progress === 100) !== parsed.checked) {
            errors.push(`${curLabel}: 进度 ${progress} 与勾选状态 ${parsed.checked ? "[x]" : "[ ]"} 矛盾`);
          }
        }
        // 主行断裂(上一行是主行的续行)
        if (i > 0 && lines[i - 1].trim() && !isIndented(lines[i - 1]) && !CHECKBOX_RE.test(lines[i - 1].trim()) && !lines[i - 1].trim().startsWith("#")) {
          errors.push(`todo.md:${i - 1}: 疑似多行主行断裂 → ${lines[i - 1].trim().slice(0, 30)}`);
        }
        // 来源链接有效性
        if (parsed.source) {
          const [p, anchor] = parsed.source.split("#");
          if (p.endsWith(".md")) {
            const abs = join(ROOT, p);
            if (!existsSync(abs)) {
              errors.push(`${curLabel}: 来源文件不存在 → ${p}`);
            } else if (anchor) {
              const set = dayAnchors.get(abs);
              if (set && !set.has(anchor)) {
                errors.push(`${curLabel}: 来源锚点不存在 → #${anchor}`);
              }
            }
          }
        }
        // 完成标记格式
        const dm = line.match(/\*\*已于([^*]+)完成\*\*/);
        if (dm && !/^\s*\d{4}-\d{2}-\d{2}(\s+\d{2}:\d{2})?\s*$/.test(dm[1])) {
          warnings.push(`${curLabel}: 完成标记时间格式异常 → ${dm[1].trim()}`);
        }
        continue;
      }
      // 分节/分组标题
      if (trimmed.startsWith("## ") || trimmed.startsWith("### ")) { subState = "main"; continue; }
      // 缩进子行
      if (isIndented(line)) {
        const indent = line.match(/^ */)![0].length;
        const im = trimmed.match(IMG_RE);
        if (im) {
          const expect = subState === "reply" ? 6 : 4;
          if (indent !== expect) warnings.push(`${curLabel}: 图片缩进 ${indent}格(期望${expect}格)`);
          const src = im[2].trim();
          if (src.startsWith("projects/") && !existsSync(join(ROOT, src))) {
            // todo.md 子块多为站点写入的历史内容(只增不删),缺失降为警告;
            // 助手写入路径(record add)自身保证附件先落盘再引用
            warnings.push(`${curLabel}: 附件不存在 → ${src}`);
          }
          continue;
        }
        const sm = trimmed.match(SUBFIELD_RE);
        if (sm) {
          const field = sm[1].trim();
          if (field === FIELD.doneText || field === FIELD.doneImgs) {
            if (indent !== 2) warnings.push(`${curLabel}: 「${field}」缩进 ${indent}格(期望2格)`);
            subState = "completion";
          } else if (field === FIELD.feedback) {
            if (indent !== 2) warnings.push(`${curLabel}: 「反馈」缩进 ${indent}格(期望2格)`);
            subState = "feedback";
          } else if (field === FIELD.reply) {
            if (indent !== 4) warnings.push(`${curLabel}: 「回复」缩进 ${indent}格(期望4格)`);
            subState = "reply";
          }
        }
        continue;
      }
      // 非缩进、非主行、非标题的裸行 → 疑似断裂主行的续行(跳过引用注释与分隔线)
      if (!trimmed.startsWith("#") && !trimmed.startsWith(">") && !trimmed.startsWith("---") && !CHECKBOX_RE.test(trimmed)) {
        errors.push(`todo.md:${i + 1}: 裸行(疑似主行断裂或多录) → ${trimmed.slice(0, 30)}`);
      }
    }
  }

  // ---- index.md ----
  const indexPath = join(ROOT, "index.md");
  if (!existsSync(indexPath)) {
    errors.push("index.md 不存在");
  } else {
    const raw = readFileSync(indexPath, "utf-8");
    for (const m of raw.matchAll(/^- \[(\d{4}-\d{2}-\d{2})\]\(([^)]+)\)/gm)) {
      if (!existsSync(join(ROOT, m[2]))) errors.push(`index.md: 链接目标不存在 → ${m[2]}`);
    }
    // 每个记录日应在 index 有条目(警告级)
    for (const p of projects) {
      for (const d of p.days) {
        const rel = `projects/${p.slug}/daily/${d.month}/${d.date}/${d.date}.md`;
        if (!raw.includes(rel)) warnings.push(`index.md: 缺少 ${rel} 的登记`);
      }
    }
  }

  return { errors, warnings };
}

function cmdCheck(argv: string[]): void {
  const asJson = argv.includes("--json");
  const { errors, warnings } = checkAll();
  if (asJson) {
    console.log(JSON.stringify({ ok: errors.length === 0, errors, warnings }, null, 2));
    process.exit(errors.length ? 1 : 0);
  }
  if (errors.length) console.log(`✖ 校验未通过: ${errors.length} 个错误, ${warnings.length} 个警告`);
  else if (warnings.length) console.log(`⚠ 通过,但有 ${warnings.length} 个警告`);
  else console.log("✔ 全库校验通过");
  for (const e of errors) console.log(`  ✖ ${e}`);
  for (const w of warnings) console.log(`  ⚠ ${w}`);
  process.exit(errors.length ? 1 : 0);
}

/* ---------------- done:实现 ---------------- */

function cmdDone(argv: string[]): void {
  const name = argv[0] && !argv[0].startsWith("--") ? argv[0] : "";
  if (!name) fail('done 需要事项名: node dist/record.js done "事项名" [选项]');
  let source = "";
  let note = "";
  let imagesSrc: string[] = [];
  let at = "";
  let noDaylog = false;
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    const next = () => { const v = argv[++i]; if (v === undefined) fail(`${a} 缺少取值`); return v; };
    if (a === "--source") source = next();
    else if (a === "--note") note = next();
    else if (a === "--images") imagesSrc = next().split(",").map((s) => s.trim()).filter(Boolean);
    else if (a === "--at") at = next();
    else if (a === "--no-daylog") noDaylog = true;
    else fail(`done 不认识的参数: ${a}`);
  }
  if (at && !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(at)) fail(`--at 需为 "YYYY-MM-DD HH:MM": ${at}`);
  const stamp = at || nowStamp();
  const date = stamp.slice(0, 10);

  const todoPath = join(ROOT, "todo.md");
  if (!existsSync(todoPath)) fail("todo.md 不存在");
  const lines = readFileSync(todoPath, "utf-8").replace(/\r\n/g, "\n").split("\n");
  const hit = findTodoLine(lines, name, source);
  if (hit < 0) fail(`未找到待办「${name}」${source ? `(来源: ${source})` : ""};可用 record check 或 grep 确认名称`);

  // 复用解析器的显式分组优先/已完成混排来源兜底,不跨分节继承无关分组。
  const parsed = parseTodoLine(lines[hit])!;
  const todo = parseTodo(todoPath);
  const target = [...todo.open, ...todo.done].find((t) => t.name === parsed.name && t.source === parsed.source)!;
  const group = target.group;
  const projectNames = getProjectNames(ROOT);
  const fromGroup = Object.entries(projectNames).find(([, name]) =>
    group === name || group.startsWith(`${name}${GROUP_SEP}`) || group.startsWith(`${name}·`),
  );
  const sourceSlug = parsed.source.match(/^projects\/([^/]+)\//)?.[1];
  const slugName = fromGroup?.[0] || (sourceSlug && projectNames[sourceSlug] ? sourceSlug : "");
  if (!slugName) fail(`无法从分组「${group}」或来源反查项目 slug(请检查数据目录 projects.json 登记)`);
  const projName = projectNames[slugName];

  // 附件归档 → 完成子块
  const imgs: { alt: string; src: string }[] = [];
  const hhmm = stamp.slice(11).replace(":", "");
  imagesSrc.forEach((src, i) => {
    const rel = archiveImage(ROOT, slugName, date, hhmm, i + 1, src);
    imgs.push({ alt: "完成截图", src: `projects/${slugName}/daily/${date.slice(0, 7)}/${date}/${rel}` });
  });
  const completion: TodoCompletion | undefined = note || imgs.length ? { text: note, images: imgs } : undefined;

  const mr = markTodoDone(todoPath, name, source, stamp, completion);
  if (mr === "notfound") fail(`未找到待办「${name}」(标记阶段)`);

  // 只有未完成 → 已完成的真实转换才追加日记;already 仅补写完成情况,不重复记账。
  let daylogAppended = false;
  if (!noDaylog && mr === "done") {
    const todo = parseTodo(todoPath);
    const item = [...todo.open, ...todo.done].find((x) => x.name === name);
    const entry: DayEntryInput = {
      date,
      time: stamp.slice(11),
      title: `已完成:${name}`,
      type: item?.type || "修改",
      module: "待办完成",
      content: note || "（标记为已完成，未填写完成说明）",
      images: imgs.map((x) => ({ alt: x.alt, src: x.src })),
      sourceNote: `来自待办清单（${projName}）`,
      projectName: projName,
      systemName: group.split(GROUP_SEP)[1] || systemOf(slugName),
    };
    appendDayCompletion(ROOT, slugName, entry);
    daylogAppended = true;
  }

  console.log(JSON.stringify({
    ok: true,
    result: mr as MarkResult,
    name,
    group,
    progress: 100,
    stamp,
    daylogAppended,
    validation: validateAfterWrite(),
  }, null, 2));
}

/* ---------------- summary:AI 起草当日概要 ---------------- */

/** 用 AI 按当日条目起草一句话概要,写回当日文件 `> 概要：` 行与 index.md 摘要。 */
async function cmdSummary(argv: string[]): Promise<void> {
  let date = "";
  let project = "";
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => { const v = argv[++i]; if (v === undefined) fail(`${a} 缺少取值`); return v; };
    if (a === "--date") date = next();
    else if (a === "--project") project = next();
    else if (a === "--dry-run") dryRun = true;
    else fail(`summary 不认识的参数: ${a}`);
  }
  if (date && !DATE_RE.test(date)) fail(`--date 需为 YYYY-MM-DD: ${date}`);
  const target = date || nowStamp().slice(0, 10);

  // ai.js 在模块加载时读取环境变量,必须在 loadWorknoteEnv() 之后动态引入
  const { aiConfigured, draftDaySummary } = await import("./ai.js");
  if (!aiConfigured()) fail("AI 未配置(WORKNOTE_AI_URL/WORKNOTE_AI_KEY),无法起草概要");

  const projects = collect(ROOT).filter((p) => !project || p.slug === project || p.name === project);
  const targets = projects.flatMap((p) =>
    p.days.filter((d) => d.date === target).map((d) => ({ p, d })),
  );
  if (!targets.length) {
    fail(`${target} 没有可起草概要的记录${project ? `(项目 ${project})` : ""}`);
  }

  const results: { project: string; file: string; summary: string }[] = [];
  for (const { p, d } of targets) {
    const summary = await draftDaySummary({
      date: d.date,
      project: p.name,
      entries: d.entries.map((e) => ({
        time: e.time,
        title: e.title,
        type: e.type,
        module: e.module,
        content: e.blocks.map((b) => b.text).join("\n"),
      })),
    });
    const file = `projects/${p.slug}/daily/${d.month}/${d.date}/${d.date}.md`;
    results.push({ project: p.name, file, summary });
    if (!dryRun) {
      updateDaySummary(ROOT, p.slug, d.date, summary);
      updateIndex(ROOT, p.slug, p.name, d.meta.system || p.systems[0] || "", d.date, summary);
    }
    console.log(`${p.name} ${d.date} → ${summary}`);
  }

  if (dryRun) {
    console.log(JSON.stringify({ dryRun: true, results }, null, 2));
    return;
  }
  console.log(JSON.stringify({
    ok: true,
    date: target,
    results,
    validation: validateAfterWrite(),
  }, null, 2));
}

/* ---------------- 入口 ---------------- */

function main(): void {
  // 共用独立导出的环境加载，不隐式读取宿主配置。
  loadWorknoteEnv();
  const [cmd, ...rest] = process.argv.slice(2);
  switch (cmd) {
    case "add": cmdAdd(rest); break;
    case "check": cmdCheck(rest); break;
    case "done": cmdDone(rest); break;
    case "summary":
      cmdSummary(rest).catch((e) => fail(e instanceof Error ? e.message : String(e)));
      break;
    case "-h":
    case "--help":
    case undefined:
      usage();
      process.exit(cmd ? 0 : 1);
    default:
      fail(`未知子命令: ${cmd}\n${usage()}`);
  }
}

main();
