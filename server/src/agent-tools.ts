/**
 * 整理 Agent 工具层:把现有权威模块封装成 Agent 可调用的工具。
 *
 * 三色风险分级在工具层强制(不靠 prompt 约束):
 *   green  = 只增不删、可逆、无信息损失 —— L2 自主级直接执行;
 *   yellow = 有删除/改写语义但可审计(合并/编辑) —— 只进待确认队列,不自动执行;
 *   红色(删除带反馈/完成情况的条目、改历史正文、动附件/配置)**不提供工具**,
 *   LLM 越权调用会被 dispatch 直接驳回。
 * 记录类写入走 `record.js`/`query` 同款子进程(复用其输入校验与写后自检),
 * 待办类写入直接 import 权威模块,均为原子写。
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  collect,
  parseTodo,
  searchEntries,
  searchTodos,
  slug as anchorSlug,
  type TodoItem,
} from "./parser.js";
import { atomicWrite, findTodoLine } from "./todo-write.js";
import { createTodo } from "./todo-create.js";
import { updateTodo, deleteTodo } from "./todo-write.js";
import { listInbox, deleteInboxItem } from "./inbox.js";
import { upsertModule, upsertSub, MODULE_STATUSES } from "./modules.js";
import { buildTodoLine, isIndented, isTodoProgress, parseTodoLine } from "./todo-format.js";
import { dataRoot } from "./environment.js";
import { getProjectNames } from "./projects.js";

const ROOT = dataRoot();

const DIST = (file: string) => join(dirname(fileURLToPath(import.meta.url)), file);

/** 跑仓库自带 CLI 子进程(record add/summary/check),返回 stdout。 */
function cli(file: string, args: string[], stdin?: string): string {
  return execFileSync(process.execPath, [DIST(file), ...args], {
    cwd: ROOT,
    env: { ...process.env, WORKNOTE_ROOT: ROOT },
    encoding: "utf8",
    input: stdin,
    maxBuffer: 16 * 1024 * 1024,
  }).trim();
}

export type Risk = "green" | "yellow";

export interface ToolSpec {
  name: string;
  risk: Risk;
  desc: string;
}

/** 提供给 LLM 的工具说明(含参数形态与语义)。 */
export const TOOL_SPECS: ToolSpec[] = [
  { name: "search", risk: "green", desc: '检索全库记录与待办。args:{q:"关键词",todoOnly?:bool} 返回命中(记录:项目/日期/标题/片段;待办:名称/状态/数字进度/分组)。合并或补建前必须先搜,确认没有同事项条目。' },
  { name: "read_todo", risk: "green", desc: '读待办详情(含数字进度、完成情况与反馈)。args:{q:"名称包含词"}' },
  { name: "read_day", risk: "green", desc: '读某项目某日记录的条目标题与正文摘要。args:{slug:"example",date:"2026-10-20"}' },
  { name: "list_inbox", risk: "green", desc: "列出收件箱未整理条目(文字与截图文件路径)。无参数。" },
  { name: "create_todo_from_entry", risk: "green", desc: '记录条目里有「待办」但 todo.md 缺对应条目时补建(自动带来源锚点与分组,进度固定为0,不接收progress/done)。args:{slug,date,time,title(定位记录条目),name,note?,type}' },
  { name: "archive_inbox", risk: "green", desc: '把一条收件箱内容归档为正式记录(截图随迁),成功后清理该条目。args:{id,slug,date?,time?,title,type,module,content?,todoNote?}' },
  { name: "summarize_day", risk: "green", desc: '某日概要空缺时用 AI 起草一句话概要并写回。args:{slug,date}' },
  { name: "move_done_archived", risk: "green", desc: "把物理滞留在「## 未完成」区的已完成(- [x])条目连同子块移入「## 已完成」区(勾选状态决定归属,此操作只挪位置不改内容)。无参数。" },
  { name: "update_module", risk: "green", desc: `维护项目模块清单与验收进度。args:{slug,name,sub?(子模块名,缺省操作父模块),status?("未开始|进行中|待验收|已验收"),progress?(0-100),note?}。记录里明确提到某模块(或其子模块)验收通过/进入联调时据此更新(只改 projects/<slug>/modules.md,不动记录与待办)。` },
  { name: "merge_todo", risk: "yellow", desc: '合并重复待办:保留 keep 的状态与数字进度,把 drop 的说明与全部子块(完成情况/反馈)并入 keep 后删除 drop。args:{keep:"名称",drop:"名称"}。调用前必须先 search 确认确属重复,不同状态不可取最大进度。' },
  { name: "edit_todo_meta", risk: "yellow", desc: '补充待办元数据(不改名称/说明正文)。args:{name,priority?("高|中|低"),start?("YYYY-MM-DD"),due?("YYYY-MM-DD"),group?,progress?(0..100整数)}。进度仅凭用户明确给出的数字或明确完成/取消事实提议,必须人工确认;100联动完成,<100联动未完成并保留完成情况/附件/反馈/回复。' },
  { name: "validate", risk: "green", desc: "跑全库格式校验(record check),返回错误与警告列表。批次执行后自检用。无参数。" },
];

export interface ToolResult {
  ok: boolean;
  risk: Risk;
  /** 简短结果说明(进对话上下文)。 */
  summary: string;
  /** 结构化细节(进运行日志)。 */
  detail?: unknown;
}

function todoHasRichContent(t: TodoItem): boolean {
  return !!t.completion.text || t.completion.images.length > 0 || t.feedback.length > 0;
}

function truncate(s: string, n = 400): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

/* ---------------- 各工具实现 ---------------- */

function toolSearch(args: { q?: unknown; todoOnly?: unknown }): ToolResult {
  const q = typeof args.q === "string" ? args.q.trim() : "";
  if (!q) return { ok: false, risk: "green", summary: "缺少 q" };
  const out: string[] = [];
  if (args.todoOnly !== true) {
    const hits = searchEntries(ROOT, q).slice(0, 10);
    for (const h of hits) out.push(`[记录 ${h.date} ${h.projectName}] ${h.title}(${h.type})`);
  }
  const todos = searchTodos(ROOT, q).slice(0, 10);
  for (const t of todos) {
    out.push(`[待办 ${t.status === "open" ? "未完成" : "已完成"} ${t.progress}% ${t.group}] ${t.name}`);
  }
  return {
    ok: true,
    risk: "green",
    summary: out.length ? `命中 ${out.length} 条:\n${out.join("\n")}` : "无命中",
    detail: { count: out.length, todos: todos.map((t) => ({ name: t.name, status: t.status, progress: t.progress, group: t.group })) },
  };
}

function toolReadTodo(args: { q?: unknown }): ToolResult {
  const q = typeof args.q === "string" ? args.q.trim() : "";
  if (!q) return { ok: false, risk: "green", summary: "缺少 q" };
  const { open, done } = parseTodo(join(ROOT, "todo.md"));
  const t = [...open, ...done].find((item) => item.name.includes(q));
  if (!t) return { ok: true, risk: "green", summary: "未找到该待办" };
  const lines = [
    `名称:${t.name}`,
    `状态:${done.includes(t) ? "已完成" : "未完成"} · 进度:${t.progress}% · 分组:${t.group} · 类型:${t.type} · 优先级:${t.priority || "-"} · 预计:${t.due || "-"}`,
    `说明:${truncate(t.note, 300) || "(无)"}`,
    `完成情况:${truncate(t.completion.text, 200) || "(无)"}`,
    ...t.feedback.map((f) => `反馈[${f.by} · ${f.at}]:${truncate(f.text, 150)}`),
  ];
  return { ok: true, risk: "green", summary: lines.join("\n"), detail: { name: t.name, progress: t.progress } };
}

function toolReadDay(args: { slug?: unknown; date?: unknown }): ToolResult {
  const s = typeof args.slug === "string" ? args.slug : "";
  const date = typeof args.date === "string" ? args.date : "";
  const p = collect(ROOT).find((x) => x.slug === s || x.name === s);
  const d = p?.days.find((x) => x.date === date);
  if (!d) return { ok: false, risk: "green", summary: "未找到该日记录" };
  const out = d.entries.map(
    (e) => `${e.time} ${e.title} [${e.type}/${e.module}] ${truncate(e.blocks.map((b) => b.text).join(" "), 150)}`,
  );
  return {
    ok: true,
    risk: "green",
    summary: `${p!.name} ${date} 概要:${d.meta.summary || "(空)"}\n${out.join("\n")}`,
  };
}

function toolListInbox(): ToolResult {
  const items = listInbox(ROOT);
  if (!items.length) return { ok: true, risk: "green", summary: "收件箱为空" };
  const out = items.map(
    (it) => `id=${it.id} 文字:${truncate(it.text, 120) || "(无)"} 图:${it.images.map((i) => i.src).join(",") || "无"}`,
  );
  return { ok: true, risk: "green", summary: out.join("\n"), detail: { count: items.length } };
}

function toolCreateTodoFromEntry(args: Record<string, unknown>): ToolResult {
  if (args.progress !== undefined || args.done !== undefined) {
    return { ok: false, risk: "green", summary: "补建待办的进度固定为0;进度变更须走 edit_todo_meta 人工确认" };
  }
  const s = String(args.slug ?? "");
  const date = String(args.date ?? "");
  const time = String(args.time ?? "");
  const title = String(args.title ?? "");
  const p = collect(ROOT).find((x) => x.slug === s || x.name === s);
  const e = p?.days.find((x) => x.date === date)?.entries.find((x) => x.time === time && x.title.includes(title.slice(0, 12)));
  if (!p || !e) return { ok: false, risk: "green", summary: "未定位到来源条目(slug/date/time/title)" };

  const name = String(args.name ?? e.title).trim();
  const { open, done } = parseTodo(join(ROOT, "todo.md"));
  if (open.some((t) => t.name === name) || done.some((t) => t.name === name)) {
    return { ok: true, risk: "green", summary: `待办「${name}」已存在,跳过` };
  }
  const system = p.days.find((x) => x.date === date)?.meta.system || p.systems[0] || "";
  const month = date.slice(0, 7);
  const source = `projects/${p.slug}/daily/${month}/${date}/${date}.md#${anchorSlug(`${time} ${e.title}`)}`;
  const r = createTodo(join(ROOT, "todo.md"), {
    projectName: p.name,
    name,
    note: String(args.note ?? "").trim(),
    type: String(args.type ?? e.type ?? "需求"),
    source,
    sourceText: `${date} ${time}`,
    system,
    progress: 0,
  });
  if (!r.ok) return { ok: false, risk: "green", summary: `创建失败:${r.error}` };
  return { ok: true, risk: "green", summary: `已补建待办「${name}」(0%)→ ${r.group}`, detail: { group: r.group, progress: 0 } };
}

function toolArchiveInbox(args: Record<string, unknown>): ToolResult {
  const id = String(args.id ?? "");
  const item = listInbox(ROOT).find((x) => x.id === id);
  if (!item) return { ok: false, risk: "green", summary: `收件箱无条目 ${id}` };
  const slug = String(args.slug ?? "");
  const projectNames = getProjectNames(ROOT);
  if (!projectNames[slug]) {
    return { ok: false, risk: "green", summary: `项目 slug 不合法:${slug}(请在 projects.json 登记；可选 ${Object.keys(projectNames).join("/") || "无"})` };
  }
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(args.date)) ? String(args.date) : item.at.slice(0, 10);
  const time = /^\d{2}:\d{2}$/.test(String(args.time)) ? String(args.time) : item.at.slice(11);
  const input = {
    project: slug,
    date,
    system: String(args.system ?? ""),
    entries: [
      {
        time,
        title: String(args.title ?? "收件箱归档"),
        type: String(args.type ?? "需求"),
        module: String(args.module ?? "收件箱"),
        content: String(args.content ?? item.text),
        todoNote: String(args.todoNote ?? "") || undefined,
        images: item.images.map((im) => ({
          alt: im.alt || "截图",
          src: join(ROOT, "inbox", "attachments", im.src.replace(/^attachments\//, "")),
        })),
      },
    ],
  };
  let out: string;
  try {
    out = cli("record.js", ["add"], JSON.stringify(input));
  } catch (e) {
    const msg = e instanceof Error && "stdout" in e ? String((e as { stdout?: Buffer }).stdout ?? e.message) : String(e);
    return { ok: false, risk: "green", summary: `归档写入失败:${truncate(msg, 300)}` };
  }
  if (!/"ok":\s*true/.test(out)) return { ok: false, risk: "green", summary: `归档未成功:${truncate(out, 300)}` };
  deleteInboxItem(ROOT, id);
  return { ok: true, risk: "green", summary: `收件箱 ${id} 已归档到 ${projectNames[slug]} ${date}`, detail: { slug, date } };
}

function toolSummarizeDay(args: Record<string, unknown>): ToolResult {
  const slug = String(args.slug ?? "");
  const date = String(args.date ?? "");
  const p = collect(ROOT).find((x) => x.slug === slug || x.name === slug);
  if (!p || !p.days.some((d) => d.date === date)) return { ok: false, risk: "green", summary: "未找到该日记录" };
  try {
    const out = cli("record.js", ["summary", "--date", date, "--project", p.slug]);
    return { ok: true, risk: "green", summary: truncate(out.split("\n")[0] || out, 200) };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, risk: "green", summary: `概要起草失败:${truncate(msg, 200)}` };
  }
}

/** 把「## 未完成」区里的 - [x] 块物理挪到「## 已完成」区首部(内容不变)。 */
function toolMoveDoneArchived(): ToolResult {
  const file = join(ROOT, "todo.md");
  const lines = readFileSync(file, "utf-8").replace(/\r\n/g, "\n").split("\n");
  let openIdx = -1;
  let doneIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const s = lines[i].trim();
    if (s.startsWith("## 未完成")) openIdx = i;
    if (s.startsWith("## 已完成")) doneIdx = i;
  }
  if (openIdx < 0 || doneIdx < 0 || openIdx > doneIdx) {
    return { ok: false, risk: "green", summary: "todo.md 分区异常" };
  }
  // 在未完成区收集 [x] 主行 + 其缩进子块
  const toMove: string[][] = [];
  const remove: number[] = [];
  for (let i = openIdx + 1; i < doneIdx; i++) {
    const t = lines[i].trim();
    if (t.startsWith("### ")) continue;
    const m = t.match(/^-\s*\[x\]\s+/);
    if (m) {
      const block = [lines[i]];
      let j = i + 1;
      for (; j < doneIdx && isIndented(lines[j]); j++) block.push(lines[j]);
      toMove.push(block);
      remove.push(i, ...Array.from({ length: j - i - 1 }, (_, k) => i + 1 + k));
      i = j - 1;
    }
  }
  if (!toMove.length) return { ok: true, risk: "green", summary: "未完成区没有物理滞留的已完成条目" };
  const next = lines.filter((_, idx) => !remove.includes(idx));
  // 重新定位已完成区,把块插到该节标题后(完成倒序=最新在前:按原出现顺序倒插)
  const doneAt = next.findIndex((l) => l.trim().startsWith("## 已完成"));
  const insert = toMove.reverse().flatMap((b) => [...b, ""]);
  next.splice(doneAt + 1, 0, ...insert, "");
  atomicWrite(file, next.join("\n"));
  return { ok: true, risk: "green", summary: `已把 ${toMove.length} 条已完成条目挪入「已完成」区` };
}

/** 合并重复待办:保留 keep,并入 drop 的说明与全部子块后删除 drop。一次原子写。 */
function toolMergeTodo(args: Record<string, unknown>): ToolResult {
  const keep = String(args.keep ?? "").trim();
  const drop = String(args.drop ?? "").trim();
  if (!keep || !drop) return { ok: false, risk: "yellow", summary: "缺少 keep/drop" };
  if (keep === drop) return { ok: false, risk: "yellow", summary: "keep 与 drop 相同" };
  const file = join(ROOT, "todo.md");
  const lines = readFileSync(file, "utf-8").replace(/\r\n/g, "\n").split("\n");
  const k = findTodoLine(lines, keep, "");
  const d = findTodoLine(lines, drop, "");
  if (k < 0 || d < 0) return { ok: false, risk: "yellow", summary: "未定位到条目(名称需与 search 结果完全一致)" };
  const kp = parseTodoLine(lines[k]);
  const dp = parseTodoLine(lines[d]);
  if (!kp || !dp) return { ok: false, risk: "yellow", summary: "主行解析失败" };

  // 收集两个条目的缩进子块(完成情况/反馈/回复)
  const blockOf = (start: number): string[] => {
    const out: string[] = [];
    for (let j = start + 1; j < lines.length && isIndented(lines[j]); j++) out.push(lines[j]);
    return out;
  };
  const kBlock = blockOf(k);
  const dBlock = blockOf(d);

  const mergedNote = [kp.note, dp.note && dp.note !== kp.note ? `(并:${dp.note})` : ""]
    .filter(Boolean)
    .join(" ")
    .replace(/\s*\n\s*/g, " ");
  const due = kp.due && dp.due ? (kp.due < dp.due ? kp.due : dp.due) : kp.due || dp.due;
  const start = kp.start && dp.start ? (kp.start < dp.start ? kp.start : dp.start) : kp.start || dp.start;
  // 合并不表示完成事实:即便 drop 已完成或进度更高,也只保留 keep 的状态与进度。
  const newLine = buildTodoLine({
    name: kp.name,
    note: mergedNote,
    priority: kp.priority || dp.priority,
    start,
    due,
    type: kp.type || dp.type,
    source: kp.source || dp.source,
    sourceText: kp.sourceText || dp.sourceText,
    progress: kp.progress,
  }).replace(/^(-\s*)\[[ xX]\]/, kp.checked ? "$1[x]" : "$1[ ]");

  // 先删靠后的块(行号不位移),再在 keep 原位替换为合并结果
  const drops = [
    [k, kBlock.length + 1] as [number, number],
    [d, dBlock.length + 1] as [number, number],
  ].sort((a, b) => b[0] - a[0]);
  for (const [start, len] of drops) lines.splice(start, len);
  const insertAt = k < d ? k : k - (dBlock.length + 1);
  lines.splice(insertAt, 0, newLine, ...kBlock, ...dBlock);
  atomicWrite(file, lines.join("\n"));
  return {
    ok: true,
    risk: "yellow",
    summary: `已合并:「${dp.name}」并入「${kp.name}」(子块 ${dBlock.length} 行随迁)`,
    detail: { keep: kp.name, drop: dp.name, progress: kp.progress },
  };
}

function toolEditTodoMeta(args: Record<string, unknown>): ToolResult {
  const name = String(args.name ?? "").trim();
  if (!name) return { ok: false, risk: "yellow", summary: "缺少 name" };
  const priority = typeof args.priority === "string" && ["高", "中", "低"].includes(args.priority) ? args.priority : undefined;
  const start = typeof args.start === "string" && /^\d{4}-\d{2}-\d{2}$/.test(args.start) ? args.start : undefined;
  const due = typeof args.due === "string" && /^\d{4}-\d{2}-\d{2}$/.test(args.due) ? args.due : undefined;
  const group = typeof args.group === "string" && args.group.trim() ? args.group.trim() : undefined;
  const progress = args.progress;
  if (progress !== undefined && !isTodoProgress(progress)) {
    return { ok: false, risk: "yellow", summary: "progress 需为 0..100 整数" };
  }
  // 显式 0 是合法编辑(含取消完成),不能以 truthiness 判定有没有可改字段。
  if (!priority && !start && !due && !group && progress === undefined) return { ok: false, risk: "yellow", summary: "没有可改字段" };
  const r = updateTodo(join(ROOT, "todo.md"), name, "", {
    priority,
    start,
    due,
    group,
    project: undefined,
    progress,
  });
  if (r === "notfound") return { ok: false, risk: "yellow", summary: "未找到该待办" };
  return { ok: true, risk: "yellow", summary: `已更新「${name}」元数据${progress !== undefined ? ` · 进度:${progress}%` : ""}`, detail: { progress } };
}

function toolValidate(): ToolResult {
  try {
    const out = cli("record.js", ["check", "--json"]);
    const j = JSON.parse(out) as { errors: string[]; warnings: string[] };
    return {
      ok: j.errors.length === 0,
      risk: "green",
      summary: j.errors.length
        ? `校验失败 ${j.errors.length} 错:\n${j.errors.slice(0, 5).join("\n")}`
        : `校验通过(${j.warnings.length} 警告)`,
      detail: { errors: j.errors.length, warnings: j.warnings.length },
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, risk: "green", summary: `校验执行失败:${truncate(msg, 200)}` };
  }
}

/** 维护项目模块清单(新增/更新验收状态)。 */
function toolUpdateModule(args: Record<string, unknown>): ToolResult {
  const slug = String(args.slug ?? "");
  const name = String(args.name ?? "").trim();
  const projectNames = getProjectNames(ROOT);
  if (!slug || !projectNames[slug]) {
    return { ok: false, risk: "green", summary: `项目 slug 不合法:${slug}(请在 projects.json 登记；可选 ${Object.keys(projectNames).join("/") || "无"})` };
  }
  if (!name) return { ok: false, risk: "green", summary: "缺少模块名" };
  const status = typeof args.status === "string" ? args.status : undefined;
  if (status && !(MODULE_STATUSES as readonly string[]).includes(status)) {
    return { ok: false, risk: "green", summary: `状态需为 ${MODULE_STATUSES.join("|")}` };
  }
  const progress = typeof args.progress === "number" ? args.progress : undefined;
  if (progress !== undefined && (!Number.isFinite(progress) || progress < 0 || progress > 100)) {
    return { ok: false, risk: "green", summary: "进度需为 0-100" };
  }
  const note = typeof args.note === "string" ? args.note.trim().slice(0, 200) : undefined;
  const d = new Date();
  const p2 = (n: number) => String(n).padStart(2, "0");
  const sub = typeof args.sub === "string" && args.sub.trim() ? args.sub.trim() : undefined;
  const updated = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
  const r = sub
    ? upsertSub(ROOT, slug, name, { name: sub, status, progress, note, updated })
    : upsertModule(ROOT, slug, { name, status, progress, note, updated });
  if (!r.ok) return { ok: false, risk: "green", summary: r.error };
  return {
    ok: true,
    risk: "green",
    summary: `模块「${sub ? `${name} / ${sub}` : name}」(${projectNames[slug]})已登记/更新:${status ?? "状态保持"}${progress !== undefined ? ` 进度 ${progress}%` : ""}`,
    detail: { slug, name, sub, status, progress },
  };
}

/* ---------------- dispatch ---------------- */

/** 工具分派入口。未知工具/参数非法直接驳回(红线在层内强制:相关工具根本不存在)。 */
export function runTool(name: string, args: Record<string, unknown>): ToolResult {
  switch (name) {
    case "search": return toolSearch(args);
    case "read_todo": return toolReadTodo(args);
    case "read_day": return toolReadDay(args);
    case "list_inbox": return toolListInbox();
    case "create_todo_from_entry": return toolCreateTodoFromEntry(args);
    case "archive_inbox": return toolArchiveInbox(args);
    case "summarize_day": return toolSummarizeDay(args);
    case "move_done_archived": return toolMoveDoneArchived();
    case "update_module": return toolUpdateModule(args);
    case "merge_todo": return toolMergeTodo(args);
    case "edit_todo_meta": return toolEditTodoMeta(args);
    case "validate": return toolValidate();
    default:
      return { ok: false, risk: "green", summary: `未知工具:${name}(仅允许 ${TOOL_SPECS.map((t) => t.name).join("/")})` };
  }
}

/** 三色策略:当前级别下该工具是否自动执行。 */
export function allowsAuto(risk: Risk, level: "L1" | "L2"): boolean {
  if (level === "L1") return false;
  return risk === "green";
}
