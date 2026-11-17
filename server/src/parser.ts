/**
 * 解析层:把 Markdown 记录读取为结构化数据。
 *
 * 数据源保持不变(projects/ 下的每日记录 + 根目录 todo.md),
 * 与 build.py 的解析规则一一对应,保证既有记录不丢、语义一致。
 */

import { readFileSync, readdirSync, statSync, existsSync, lstatSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseTodoLine, parseSubBlocks, isIndented } from "./todo-format.js";
import { getProjectNames, readProjectConfig } from "./projects.js";

export type BlockImage = { alt: string; src: string };
export type Block = { field: string; text: string; images: BlockImage[]; html: string };

export type Entry = {
  time: string;
  title: string;
  type: string;
  module: string;
  anchor: string;
  blocks: Block[];
};

export type DayMeta = { project: string; system: string; summary: string };

export type Day = {
  slug: string;
  projectName: string;
  date: string;
  month: string;
  weekday: string;
  meta: DayMeta;
  entries: Entry[];
  counts: Record<string, number>;
  attachments: string;
};

export type TodoItem = {
  name: string;
  note: string;
  priority: string;
  /** 完成进度0–100;完成态为100,历史未完成缺省0。 */
  progress: number;
  start: string;
  due: string;
  type: string;
  group: string;
  source: string;
  sourceText: string;
  /** 完成情况(文字与图片);无则 text 为空、images 为空数组。 */
  completion: { text: string; images: { alt: string; src: string }[] };
  /** 反馈列表(分享链接提交,可多条)。 */
  feedback: { by: string; at: string; text: string; images: { alt: string; src: string }[] }[];
  /** 是否为本站新建(无来源链接即为新建)。 */
  created: boolean;
};

export type Project = {
  slug: string;
  name: string;
  systems: string[];
  dayCount: number;
  entryCount: number;
  counts: Record<string, number>;
  modules: { name: string; count: number }[];
  dateRange: [string, string];
  days: Day[];
};

export const PRIORITY_ORDER = ["高", "中", "低"] as const;
export const TYPE_ORDER = ["待排查", "需求", "修改", "优化"] as const;
const WEEKDAY_CN = ["一", "二", "三", "四", "五", "六", "日"];
const ENTRY_RE = /^##\s+(\d{2}:\d{2})\s+(.+)$/;

/** 标题 -> 锚点 slug(记录条目锚点与待办来源链接共用此算法,勿各写各的)。 */
export function slug(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[^\w一-鿿]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function weekdayOf(date: string): string {
  const d = new Date(date + "T00:00:00Z");
  // getUTCDay: 0=周日
  const idx = (d.getUTCDay() + 6) % 7; // 转为 0=周一
  return WEEKDAY_CN[idx];
}

function countBy<T>(items: T[], key: (t: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const it of items) {
    const k = key(it);
    if (k) out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

/** 规范化系统名称:使用 NFKC 去除全半角括号差异等字符异形。 */
export function normalizeSystemName(name: string): string {
  return name.normalize("NFKC").trim();
}

/** 把条目正文按字段拆成有序块(只解析文本与图片,html 留空;
 *  需要渲染的消费方(如 API 出参)自行调用 index.ts 的 renderBlockHtml,
 *  让搜索/CLI 路径完全跳过 marked 加载与渲染)。 */
function parseBlocks(body: string): Block[] {
  const blocks: Block[] = [];
  let cur: Block | null = null;
  for (const raw of body.split("\n")) {
    const s = raw.replace(/\s+$/, "");
    const m = s.trim().match(/^-\s*\*\*([^*]+)\*\*：(.*)$/);
    if (m) {
      cur = { field: m[1].trim(), text: m[2].trim(), images: [], html: "" };
      blocks.push(cur);
      continue;
    }
    if (!cur) continue;
    const im = s.match(/^\s*!\[([^\]]*)\]\(([^)]+)\)\s*$/);
    if (im) {
      cur.images.push({ alt: im[1].trim(), src: im[2].trim() });
      continue;
    }
    if (s.trim() && !/^\s*-{3,}\s*$/.test(s)) {
      cur.text += (cur.text ? "\n" : "") + s;
    }
  }
  return blocks;
}

/** 从字段文本里取字段值(第一条匹配)。 */
function fieldOf(body: string, name: string): string {
  const re = new RegExp(`^-\\s*\\*\\*${name}\\*\\*：(.+)$`, "m");
  const m = body.match(re);
  return m ? m[1].trim() : "";
}

/**
 * 日文件解析缓存:按 mtime+size 判定未变则复用,变了才重读重解析。
 * 请求路径上的全库扫描因此从「全量读+解析」降为「stat 比对」,数据量增长延迟保持平坦。
 */
const dayCache = new Map<string, { mtimeMs: number; size: number; data: { meta: DayMeta; entries: Entry[] } }>();

function parseDayCached(
  file: string,
  slugName: string,
  date: string,
  month: string,
): { meta: DayMeta; entries: Entry[] } {
  const st = statSync(file);
  const hit = dayCache.get(file);
  if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.data;
  const data = parseDay(file, slugName, date, month);
  dayCache.set(file, { mtimeMs: st.mtimeMs, size: st.size, data });
  return data;
}

/** 解析一天的记录文件。 */
function parseDay(
  file: string,
  slugName: string,
  date: string,
  month: string,
): { meta: DayMeta; entries: Entry[] } {
  const text = readFileSync(file, "utf-8").replace(/\r\n/g, "\n");
  const lines = text.split("\n");

  const meta: DayMeta = { project: "", system: "", summary: "" };
  for (const ln of lines.slice(0, 12)) {
    const t = ln.trim();
    let m = t.match(/^-\s*\*\*项目\*\*：(.+)$/);
    if (m) meta.project = m[1].trim();
    m = t.match(/^-\s*\*\*系统\*\*：(.+)$/);
    if (m) meta.system = normalizeSystemName(m[1]);
    m = t.match(/^>\s*概要：(.+)$/);
    if (m) meta.summary = m[1].trim();
  }

  const starts: number[] = [];
  lines.forEach((ln, i) => {
    if (ENTRY_RE.test(ln)) starts.push(i);
  });

  const entries: Entry[] = [];
  starts.forEach((start, n) => {
    const end = n + 1 < starts.length ? starts[n + 1] : lines.length;
    const m = lines[start].match(ENTRY_RE)!;
    let body = lines.slice(start + 1, end).join("\n").trim();
    body = body.replace(/\n?-{3,}\s*$/, "").trim();
    const title = m[2].trim();
    entries.push({
      time: m[1],
      title,
      type: fieldOf(body, "类型"),
      module: fieldOf(body, "模块"),
      anchor: slug(`${m[1]} ${title}`),
      blocks: parseBlocks(body),
    });
  });

  return { meta, entries };
}

/** todo.md 解析缓存;项目映射也参与命中判定,配置改名不会留下旧的来源推导分组。 */
const todoCache = new Map<string, { mtimeMs: number; size: number; ino: number; ctimeMs: number; projectKey: string; data: { open: TodoItem[]; done: TodoItem[] } }>();

/** 解析 todo.md -> 未完成 / 已完成。项目配置总是来自此文件所在数据根。 */
export function parseTodo(todoPath: string): { open: TodoItem[]; done: TodoItem[] } {
  const projectNames = getProjectNames(dirname(todoPath));
  if (!existsSync(todoPath)) return { open: [], done: [] };
  const projectKey = JSON.stringify(projectNames);
  const st = statSync(todoPath);
  const hit = todoCache.get(todoPath);
  if (hit && hit.projectKey === projectKey && hit.mtimeMs === st.mtimeMs && hit.size === st.size && hit.ino === st.ino && hit.ctimeMs === st.ctimeMs) return hit.data;
  const data = parseTodoUncached(todoPath, projectNames);
  todoCache.set(todoPath, { mtimeMs: st.mtimeMs, size: st.size, ino: st.ino, ctimeMs: st.ctimeMs, projectKey, data });
  return data;
}

function parseTodoUncached(todoPath: string, projectNames: Record<string, string>): { open: TodoItem[]; done: TodoItem[] } {
  if (!existsSync(todoPath)) return { open: [], done: [] };
  const text = readFileSync(todoPath, "utf-8").replace(/\r\n/g, "\n");
  const open: TodoItem[] = [];
  const done: TodoItem[] = [];
  let group = "";
  let section: "open" | "done" | null = null;
  const lines = text.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const s = lines[i].trim();
    if (s.startsWith("## 未完成")) {
      section = "open";
      group = "";
      continue;
    }
    if (s.startsWith("## 已完成")) {
      section = "done";
      group = "";
      continue;
    }
    if (s.startsWith("### ")) {
      group = s.slice(4).trim();
      continue;
    }
    // 缩进行属于上一条待办的子块,不单独成项
    if (isIndented(lines[i])) continue;

    const parsed = parseTodoLine(lines[i]);
    if (!parsed) continue;

    // 收集紧随其后的缩进子行(完成情况 / 反馈)
    const sub: string[] = [];
    for (let j = i + 1; j < lines.length && isIndented(lines[j]); j++) sub.push(lines[j]);

    const blocks = parseSubBlocks(sub);
    const item: TodoItem = {
      name: parsed.name,
      note: parsed.note,
      priority: parsed.priority,
      progress: parsed.progress,
      start: parsed.start,
      due: parsed.due,
      type: parsed.type,
      group,
      source: parsed.source,
      sourceText: parsed.sourceText,
      completion: blocks.completion,
      feedback: blocks.feedback,
      created: !parsed.source,
    };
    // 已完成区可能按日期混排,重新打开后也不能继承无关项目的末尾分组。
    // 显式分组优先(支持改归属),只有混排无分组时才由来源路径推导。
    if (!group && section === "done") {
      const m = parsed.source.match(/^projects\/([^/]+)\//);
      if (m && projectNames[m[1]]) item.group = projectNames[m[1]];
    }
    (parsed.checked ? done : open).push(item);
  }
  return { open, done };
}

/** 汇总已登记项目(含空项目)与每日记录。无登记文件时由 projects.ts 发现目录。 */
export function collect(root: string): Project[] {
  const projectsDir = join(root, "projects");
  const projects: Project[] = [];

  for (const config of readProjectConfig(root)) {
    const slugName = config.slug;
    const dailyDir = join(projectsDir, slugName, "daily");
    const days: Day[] = [];
    if (existsSync(dailyDir) && lstatSync(dailyDir).isDirectory()) {
      for (const month of readdirSync(dailyDir).sort().reverse()) {
        if (!/^\d{4}-\d{2}$/.test(month)) continue;
        const mdir = join(dailyDir, month);
        if (!lstatSync(mdir).isDirectory()) continue;
        for (const day of readdirSync(mdir).sort().reverse()) {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
          const dayDir = join(mdir, day);
          if (!lstatSync(dayDir).isDirectory()) continue;
          const note = join(dayDir, `${day}.md`);
          if (!existsSync(note) || !lstatSync(note).isFile()) continue;
          const { meta, entries } = parseDayCached(note, slugName, day, month);
          days.push({
            slug: slugName,
            projectName: config.name,
            date: day,
            month,
            weekday: weekdayOf(day),
            meta,
            entries,
            counts: countBy(entries, (e) => e.type),
            attachments: `attachments/${slugName}/${day}`,
          });
        }
      }
    }
    days.sort((a, b) => (a.date < b.date ? 1 : -1));

    const allEntries = days.flatMap((d) => d.entries);
    const modCounts = countBy(allEntries, (e) => e.module);
    const systems = [...new Set(days.map((d) => normalizeSystemName(d.meta.system)).filter(Boolean))].sort();
    const defaultSystem = config.system ? normalizeSystemName(config.system) : "";
    projects.push({
      slug: slugName,
      name: config.name,
      // 首项始终为登记的默认系统;无登记值时保持既有系统排序规则。
      systems: defaultSystem ? [defaultSystem, ...systems.filter((s) => s !== defaultSystem)] : systems,
      dayCount: days.length,
      entryCount: allEntries.length,
      counts: countBy(allEntries, (e) => e.type),
      modules: Object.entries(modCounts)
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count),
      dateRange: days.length ? [days[days.length - 1].date, days[0].date] : ["", ""],
      days,
    });
  }
  return projects;
}

/** 把记录里的相对附件路径解析为站点绝对路径。 */
export function resolveAttachment(src: string, slugName: string, date: string): string {
  if (/^(https?:)?\/\//.test(src) || src.startsWith("data:")) return src;
  const clean = src.replace(/^\.?\/?(?:attachments\/)?/, "");
  return `/attachments/${slugName}/${date}/${clean}`;
}

/* ---------------- 全部记录浏览 ---------------- */

/** 单日条目精简概览。 */
export type EntrySummary = {
  time: string;
  title: string;
  module: string;
  type: string;
  anchor: string;
};

/** 单日摘要(供「全部记录」页跨项目分页与时间轴呈现)。 */
export type DaySummary = {
  slug: string;
  projectName: string;
  system: string;
  date: string;
  weekday: string;
  entryCount: number;
  summary: string;
  counts: Record<string, number>;
  entries: EntrySummary[];
};

/** 跨项目按日期倒序列出每日摘要,支持 offset/limit 切片。 */
export function listDaySummaries(
  root: string,
  offset: number,
  limit: number,
): { items: DaySummary[]; total: number; dayCount: number } {
  const all: DaySummary[] = [];
  const dates = new Set<string>();
  for (const p of collect(root)) {
    for (const d of p.days) {
      dates.add(d.date);
      all.push({
        slug: p.slug,
        projectName: p.name,
        system: d.meta.system || (p.systems[0] ?? ""),
        date: d.date,
        weekday: d.weekday,
        entryCount: d.entries.length,
        summary: d.meta.summary,
        counts: d.counts,
        entries: d.entries.map((e) => ({
          time: e.time,
          title: e.title,
          module: e.module,
          type: e.type,
          anchor: e.anchor,
        })),
      });
    }
  }
  all.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return { items: all.slice(offset, offset + limit), total: all.length, dayCount: dates.size };
}

/* ---------------- 全站搜索 ---------------- */

/** 命中条目:定位到具体记录的某一条事项。 */
export type SearchHit = {
  slug: string;
  projectName: string;
  date: string;
  weekday: string;
  time: string;
  title: string;
  module: string;
  type: string;
  anchor: string;
  snippet: string;
};

/** 待办命中:匹配名称、说明、分组、完成情况与反馈正文。 */
export type TodoSearchHit = {
  name: string;
  note: string;
  group: string;
  type: string;
  priority: string;
  progress: number;
  start: string;
  due: string;
  source: string;
  sourceText: string;
  status: "open" | "done";
  snippet: string;
};

/** 把块文本压成单行纯文本,用于搜索匹配与摘要。 */
function plainText(e: Entry): string {
  return e.blocks.map((b) => b.text).join("\n");
}

/** 截取命中词周围的片段(不区分大小写)。 */
function snippetOf(text: string, q: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const i = flat.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return flat.slice(0, 80);
  const start = Math.max(0, i - 30);
  const end = Math.min(flat.length, i + q.length + 50);
  return (start > 0 ? "…" : "") + flat.slice(start, end) + (end < flat.length ? "…" : "");
}

/** 全站搜索:匹配标题、模块与各字段正文,大小写不敏感。 */
export function searchEntries(root: string, query: string): SearchHit[] {
  const q = query.trim();
  if (q.length < 1) return [];
  const needle = q.toLowerCase();
  const hits: SearchHit[] = [];

  for (const p of collect(root)) {
    for (const d of p.days) {
      for (const e of d.entries) {
        const body = plainText(e);
        const hay = `${e.title}\n${e.module}\n${body}`.toLowerCase();
        if (!hay.includes(needle)) continue;
        hits.push({
          slug: p.slug,
          projectName: p.name,
          date: d.date,
          weekday: d.weekday,
          time: e.time,
          title: e.title,
          module: e.module,
          type: e.type,
          anchor: e.anchor,
          snippet: snippetOf(hay.includes(needle) ? body || e.title : e.title, q),
        });
      }
    }
  }
  hits.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.time < b.time ? 1 : -1));
  return hits;
}

/** 全站待办搜索:匹配名称、说明、分组、完成情况与反馈,大小写不敏感。 */
export function searchTodos(root: string, query: string): TodoSearchHit[] {
  const q = query.trim();
  if (q.length < 1) return [];
  const needle = q.toLowerCase();
  const out: TodoSearchHit[] = [];
  const { open, done } = parseTodo(join(root, "todo.md"));
  for (const [status, list] of [["open", open], ["done", done]] as const) {
    for (const t of list) {
      const feedbackText = t.feedback
        .map((f) => `${f.by} ${f.text} ${(f as { reply?: { text: string } }).reply?.text ?? ""}`)
        .join("\n");
      const hay = `${t.name}\n${t.note}\n${t.group}\n${t.completion.text}\n${feedbackText}`.toLowerCase();
      if (!hay.includes(needle)) continue;
      out.push({
        name: t.name,
        note: t.note,
        group: t.group,
        type: t.type,
        priority: t.priority,
        progress: t.progress,
        start: t.start,
        due: t.due,
        source: t.source,
        sourceText: t.sourceText,
        status,
        snippet: snippetOf(t.note || t.name || t.completion.text, q),
      });
    }
  }
  return out;
}