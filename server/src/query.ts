/**
 * WorkNote 检索 CLI —— 面向助手的结构化查询工具。
 *
 * 相比裸 grep 的改进:
 *   1. 多关键词 AND 匹配(如「台账 权限」要求同时命中);
 *   2. 项目 / 类型 / 模块 / 日期区间过滤,跨项目聚合不再靠人眼扫;
 *   3. 同时覆盖每日记录、日概要与待办清单(todo.md);
 *   4. 输出文件路径与锚点,可直接跳转定位。
 *
 * 用法(任选其一):
 *   node server/dist/query.js [选项] [关键词...]
 *   cd server && npm run query -- [选项] [关键词...]
 *
 * 选项:
 *   --project <slug|名>   按项目过滤(如 example 或 示例项目)
 *   --type <类型>         待排查|需求|修改|优化
 *   --module <关键词>     模块字段包含匹配
 *   --from <YYYY-MM-DD>   起始日期(含)
 *   --to <YYYY-MM-DD>     截止日期(含)
 *   --records             只查每日记录
 *   --todo                只查待办清单
 *   --status <open|done>  待办状态过滤(open=未完成, done=已完成)
 *   --limit <n>           每类结果上限(默认 20)
 *   --json                JSON 输出
 *   -h, --help            显示帮助
 *
 * 关键词可多个,要求全部命中(AND,大小写不敏感);不给关键词而只给过滤条件时,
 * 列出过滤范围内的条目(用于按条件聚合浏览)。
 */

import { resolve } from "node:path";
import { dataRoot } from "./environment.js";
import { getProjectNames } from "./projects.js";
import {
  collect,
  parseTodo,
  TYPE_ORDER,
  type Entry,
  type TodoItem,
} from "./parser.js";

type Kind = "记录" | "日概要" | "待办";

type Hit = {
  kind: Kind;
  project: string;
  slug: string;
  date: string | null;
  time?: string;
  title: string;
  type: string;
  module?: string;
  status?: "未完成" | "已完成";
  progress?: number;
  group?: string;
  priority?: string;
  path: string;
  snippet: string;
  source?: string;
};

type Options = {
  keywords: string[];
  project?: string;
  type?: string;
  module?: string;
  from?: string;
  to?: string;
  scope: "all" | "records" | "todo";
  status?: "open" | "done";
  limit: number;
  json: boolean;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const USAGE = `WorkNote 检索 CLI

用法: node server/dist/query.js [选项] [关键词...]

选项:
  --project <slug|名>   按项目过滤(如 example 或 示例项目)
  --type <类型>         ${TYPE_ORDER.join("|")}
  --module <关键词>     模块字段包含匹配
  --from <YYYY-MM-DD>   起始日期(含)
  --to <YYYY-MM-DD>     截止日期(含)
  --records             只查每日记录
  --todo                只查待办清单
  --status <open|done>  待办状态过滤(open=未完成, done=已完成)
  --limit <n>           每类结果上限(默认 20)
  --json                JSON 输出

示例:
  node server/dist/query.js 台账 --project example
  node server/dist/query.js --type 待排查 --from 2026-10-13
  node server/dist/query.js 报名 人数 --todo --status open`;

function parseArgs(argv: string[]): Options {
  const opts: Options = { keywords: [], scope: "all", limit: 20, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`选项 ${a} 缺少取值`);
      return v;
    };
    switch (a) {
      case "--project": opts.project = next(); break;
      case "--type": opts.type = next(); break;
      case "--module": opts.module = next(); break;
      case "--from": opts.from = next(); break;
      case "--to": opts.to = next(); break;
      case "--status": {
        const v = next();
        if (v !== "open" && v !== "done") throw new Error("--status 只能是 open 或 done");
        opts.status = v;
        break;
      }
      case "--records": opts.scope = "records"; break;
      case "--todo": opts.scope = "todo"; break;
      case "--limit": {
        const n = Number(next());
        if (!Number.isInteger(n) || n < 1) throw new Error("--limit 需要正整数");
        opts.limit = n;
        break;
      }
      case "--json": opts.json = true; break;
      case "-h":
      case "--help": console.log(USAGE); process.exit(0);
      default:
        if (a.startsWith("-")) throw new Error(`未知选项: ${a}`);
        opts.keywords.push(a);
    }
  }
  for (const [k, v] of [["--from", opts.from], ["--to", opts.to]] as const) {
    if (v !== undefined && !DATE_RE.test(v)) throw new Error(`${k} 需要 YYYY-MM-DD 格式`);
  }
  if (opts.type !== undefined && !TYPE_ORDER.includes(opts.type as (typeof TYPE_ORDER)[number])) {
    throw new Error(`--type 只能是 ${TYPE_ORDER.join("|")}`);
  }
  return opts;
}

/** 多关键词 AND 命中判定(小写包含)。 */
function matchAll(hay: string, keywords: string[]): boolean {
  const h = hay.toLowerCase();
  return keywords.every((k) => h.includes(k.toLowerCase()));
}

/** 截取首个关键词周围的片段;无关键词时取开头。 */
function snippetOf(text: string, keywords: string[]): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (!keywords.length) return flat.slice(0, 80);
  let i = -1;
  for (const k of keywords) {
    const at = flat.toLowerCase().indexOf(k.toLowerCase());
    if (at >= 0 && (i < 0 || at < i)) i = at;
  }
  if (i < 0) return flat.slice(0, 80);
  const start = Math.max(0, i - 30);
  const end = Math.min(flat.length, i + keywords[0].length + 60);
  return (start > 0 ? "…" : "") + flat.slice(start, end) + (end < flat.length ? "…" : "");
}

/** 项目过滤:slug 精确或显示名包含。 */
function projectMatches(slug: string, name: string, key: string): boolean {
  return slug === key || name.includes(key) || slug.includes(key);
}

/** 待办归属项目:分组名命中 slug 或其显示名。 */
function todoProjectMatches(t: TodoItem, key: string, names: Record<string, string>): boolean {
  const tokens = [key, names[key] ?? ""];
  return tokens.some((tok) => tok && t.group.includes(tok));
}

/** 待办日期:优先取来源时间,其次取完成标记;站内新建无从属日期时返回 null。 */
function todoDate(t: TodoItem): string | null {
  const fromSource = t.sourceText.match(/(\d{4}-\d{2}-\d{2})/);
  if (fromSource) return fromSource[1];
  const fromNote = t.note.match(/已于 (\d{4}-\d{2}-\d{2})/);
  return fromNote ? fromNote[1] : null;
}

function inDateRange(date: string | null, opts: Options): boolean {
  if (opts.from === undefined && opts.to === undefined) return true;
  if (date === null) return false;
  if (opts.from !== undefined && date < opts.from) return false;
  if (opts.to !== undefined && date > opts.to) return false;
  return true;
}

function entryBody(e: Entry): string {
  return e.blocks.map((b) => b.text).join("\n");
}

function todoBody(t: TodoItem): string {
  return [t.note, t.completion.text, ...t.feedback.map((f) => `${f.by} ${f.text}`)].join("\n");
}

function main(): void {
  let opts: Options;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(String(err instanceof Error ? err.message : err));
    console.error("\n" + USAGE);
    process.exit(1);
  }
  if (!opts.keywords.length && !opts.project && !opts.type && !opts.module && !opts.from && !opts.to && !opts.status && opts.scope === "all") {
    console.log(USAGE);
    return;
  }

  const root = dataRoot();
  const projectNames = getProjectNames(root);

  const hits: Hit[] = [];
  const wantRecords = opts.scope !== "todo";
  const wantTodo = opts.scope !== "records";

  /* ---- 每日记录 + 日概要 ---- */
  if (wantRecords) {
    for (const p of collect(root)) {
      if (opts.project && !projectMatches(p.slug, p.name, opts.project)) continue;
      for (const d of p.days) {
        if (!inDateRange(d.date, opts)) continue;
        const dayPath = `projects/${p.slug}/daily/${d.month}/${d.date}/${d.date}.md`;
        let dayHitCount = 0;
        for (const e of d.entries) {
          if (opts.type && e.type !== opts.type) continue;
          if (opts.module && !e.module.includes(opts.module)) continue;
          const body = entryBody(e);
          const hay = `${e.title}\n${e.module}\n${e.type}\n${body}\n${d.meta.summary}`;
          if (opts.keywords.length && !matchAll(hay, opts.keywords)) continue;
          hits.push({
            kind: "记录",
            project: p.name,
            slug: p.slug,
            date: d.date,
            time: e.time,
            title: e.title,
            type: e.type,
            module: e.module,
            path: `${dayPath}#${e.anchor}`,
            snippet: snippetOf(body || e.title, opts.keywords),
          });
          dayHitCount++;
        }
        // 日概要兜底:当天没有条目命中而概要命中时补一条,便于"某天做了什么"式查询
        if (opts.keywords.length && dayHitCount === 0) {
          const hay = `${d.meta.summary}\n${d.meta.system}\n${d.meta.project}`;
          if (matchAll(hay, opts.keywords)) {
            hits.push({
              kind: "日概要",
              project: p.name,
              slug: p.slug,
              date: d.date,
              title: `${d.date} 概要`,
              type: "概要",
              path: dayPath,
              snippet: snippetOf(d.meta.summary, opts.keywords),
            });
          }
        }
      }
    }
  }

  /* ---- 待办清单 ---- */
  const todoStats = { open: 0, done: 0 };
  if (wantTodo) {
    const { open, done } = parseTodo(resolve(root, "todo.md"));
    for (const [status, list] of [["open", open], ["done", done]] as const) {
      for (const t of list) {
        if (opts.status && opts.status !== status) continue;
        if (opts.project && !todoProjectMatches(t, opts.project, projectNames)) continue;
        if (opts.type && t.type !== opts.type) continue;
        if (opts.module && !t.group.includes(opts.module)) continue;
        const date = todoDate(t);
        if (!inDateRange(date, opts)) continue;
        const hay = `${t.name}\n${t.note}\n${t.group}\n${todoBody(t)}`;
        if (opts.keywords.length && !matchAll(hay, opts.keywords)) continue;
        if (status === "open") todoStats.open++;
        else todoStats.done++;
        hits.push({
          kind: "待办",
          project: t.group.split(" · ")[0],
          slug: "",
          date,
          title: t.name,
          type: t.type || "-",
          status: status === "open" ? "未完成" : "已完成",
          progress: t.progress,
          group: t.group,
          priority: t.priority || undefined,
          path: "todo.md",
          snippet: snippetOf(t.note || t.name, opts.keywords),
          source: t.sourceText || undefined,
        });
      }
    }
  }

  /* ---- 输出 ---- */
  const records = hits.filter((h) => h.kind === "记录").sort((a, b) => (b.date! + (b.time ?? "")).localeCompare(a.date! + (a.time ?? "")));
  const daySummaries = hits.filter((h) => h.kind === "日概要").sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  const todos = hits.filter((h) => h.kind === "待办").sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));

  if (opts.json) {
    console.log(JSON.stringify({ counts: { records: records.length, daySummaries: daySummaries.length, todos: todos.length }, hits: [...records, ...daySummaries, ...todos] }, null, 2));
    return;
  }

  const desc = [
    opts.keywords.length ? `关键词: ${opts.keywords.join(" + ")}` : "",
    opts.project ? `项目: ${opts.project}` : "",
    opts.type ? `类型: ${opts.type}` : "",
    opts.module ? `模块: ${opts.module}` : "",
    opts.from || opts.to ? `日期: ${opts.from ?? "最早"} ~ ${opts.to ?? "最新"}` : "",
    opts.status ? `待办状态: ${opts.status === "open" ? "未完成" : "已完成"}` : "",
  ].filter(Boolean).join(" | ");
  console.log(`命中 ${hits.length} 条(记录 ${records.length} / 日概要 ${daySummaries.length} / 待办 ${todos.length})${desc ? ` [${desc}]` : ""}\n`);

  const show = <T>(title: string, list: T[], render: (x: T) => void) => {
    if (!list.length) return;
    console.log(`── ${title} ${"─".repeat(Math.max(2, 40 - title.length))}`);
    for (const x of list.slice(0, opts.limit)) render(x);
    if (list.length > opts.limit) console.log(`  …另有 ${list.length - opts.limit} 条(提高 --limit 查看)`);
    console.log("");
  };

  show("记录", records, (h) => {
    console.log(`${h.project} · ${h.date} ${h.time} [${h.type}]${h.module ? ` ${h.module}` : ""}`);
    console.log(`  ${h.title}`);
    console.log(`  ${h.snippet}`);
    console.log(`  → ${h.path}\n`);
  });
  show("日概要", daySummaries, (h) => {
    console.log(`${h.project} · ${h.date}`);
    console.log(`  ${h.snippet}`);
    console.log(`  → ${h.path}\n`);
  });
  show("待办", todos, (h) => {
    console.log(`[${h.status} ${h.progress}%] ${h.group} [${h.type}]${h.priority ? ` 优先级:${h.priority}` : ""}${h.date ? ` ${h.date}` : ""}`);
    console.log(`  ${h.title}`);
    console.log(`  ${h.snippet}`);
    console.log(`  → ${h.path}${h.source ? ` · 来源: ${h.source}` : ""}\n`);
  });

  if (!hits.length) console.log("无命中。可放宽关键词,或去掉部分过滤条件。");
}

main();
