/**
 * 整理 Agent 运行时 —— 观察 → 规划 → 自主循环执行 → 自检 → 回滚/报告。
 *
 * 一个真正拿工具跑循环的 Agent:LLM 每轮输出一个工具调用(带理由),
 * 运行时执行、回喂结果、允许它根据结果调整后续计划;写操作受三色策略
 * 与级别门控(L1 只记录建议,L2 自动执行绿色、黄色进待确认队列)。
 * 安全:运行前 git 快照;结束跑全库校验,失败自动回滚到快照;预算硬顶
 * (40 步 / 2 次连续解析失败即停);每步写入运行日志 agent/runs/。
 *
 * CLI:
 *   node dist/agent.js --run              # 按站点设置运行(timer / 立即运行用)
 *   node dist/agent.js --level L1 [--dry] # 指定级别;--dry 连绿色写也不执行
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { collect, parseTodo } from "./parser.js";
import { dataRoot } from "./environment.js";
import { snapshotData, restoreDataSnapshot } from "./data-snapshot.js";
import { isIndented } from "./todo-format.js";
import { listInbox } from "./inbox.js";
import { loadWorknoteEnv, sendNotify, notifyConfigured } from "./notify.js";
import { readConfig } from "./site-config.js";
import { rawChat, aiConfigured } from "./ai.js";
import { runTool, TOOL_SPECS, allowsAuto, type Risk } from "./agent-tools.js";

loadWorknoteEnv();

const ROOT = dataRoot();

const MAX_STEPS = 40;
const MAX_PARSE_FAILS = 2;
const MAX_SECONDS = 10 * 60;
/** 会实际改动文件的写工具(L1/dry 下只记录为建议)。 */
const WRITE_TOOLS = new Set([
  "create_todo_from_entry",
  "archive_inbox",
  "summarize_day",
  "move_done_archived",
  "update_module",
  "merge_todo",
  "edit_todo_meta",
]);
type Level = "L1" | "L2";

interface Step {
  n: number;
  thought: string;
  tool: string;
  args: Record<string, unknown>;
  risk: Risk;
  executed: boolean;
  ok: boolean;
  summary: string;
}

interface RunResult {
  id: string;
  level: Level;
  dry: boolean;
  startedAt: string;
  durationMs: number;
  steps: Step[];
  executed: number;
  suggested: number;
  pendingReview: { tool: string; args: Record<string, unknown>; thought: string }[];
  finalSummary: string;
  validationOk: boolean;
  rolledBack: boolean;
  aiUsed: boolean;
}

function nowStamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function today(): string {
  return nowStamp().slice(0, 10);
}

/* ---------------- 观察期 ---------------- */

/** 收集确定性观察数据(初始上下文;细节由 Agent 用工具自查)。 */
function observe(): Record<string, unknown> {
  const staleDays = readConfig().staleDays ?? 14;
  const projects = collect(ROOT);
  const { open, done } = parseTodo(join(ROOT, "todo.md"));

  // 物理滞留在未完成区的已完成条目
  const todoRaw = readFileSync(join(ROOT, "todo.md"), "utf-8").replace(/\r\n/g, "\n").split("\n");
  let inOpen = false;
  const misplacedDone: string[] = [];
  for (const ln of todoRaw) {
    const s = ln.trim();
    if (s.startsWith("## 未完成")) { inOpen = true; continue; }
    if (s.startsWith("## 已完成")) { inOpen = false; continue; }
    if (inOpen && /^-\s*\[x\]\s+/.test(s) && !isIndented(ln)) {
      misplacedDone.push(s.replace(/^-\s*\[x\]\s+/, "").slice(0, 50));
    }
  }

  // 概要缺失 & 带「待办」字段的记录条目(同步缺口候选)
  const missingSummary: { slug: string; date: string }[] = [];
  const todoFields: { slug: string; date: string; time: string; title: string; todoNote: string; hasTodo?: boolean }[] = [];
  for (const p of projects) {
    for (const d of p.days) {
      if (!d.meta.summary.trim()) missingSummary.push({ slug: p.slug, date: d.date });
      for (const e of d.entries) {
        const f = e.blocks.find((b) => b.field === "待办");
        if (f?.text.trim()) {
          const exists = open.some((t) => t.source.includes(`/${d.date}/${d.date}.md#${e.anchor}`)) ||
            done.some((t) => t.source.includes(`/${d.date}/${d.date}.md#${e.anchor}`));
          todoFields.push({ slug: p.slug, date: d.date, time: e.time, title: e.title, todoNote: f.text.slice(0, 80), hasTodo: exists });
        }
      }
    }
  }

  const inbox = listInbox(ROOT).map((it) => ({
    id: it.id,
    text: it.text.slice(0, 100) || "(仅截图)",
    images: it.images.length,
  }));

  const staleBefore = new Date(Date.now() - staleDays * 86400_000).toISOString().slice(0, 10);
  const staleTodos = open
    .filter((t) => {
      const d = t.sourceText.match(/(\d{4}-\d{2}-\d{2})/)?.[1] ?? "";
      return d && d <= staleBefore;
    })
    .slice(0, 10)
    .map((t) => ({ name: t.name.slice(0, 60), group: t.group, progress: t.progress, since: t.sourceText.match(/(\d{4}-\d{2}-\d{2})/)?.[1] }));

  return {
    today: today(),
    staleDays,
    projects: projects.map((p) => ({ slug: p.slug, name: p.name, systems: p.systems.slice(0, 3), days: p.dayCount })),
    openTodos: open.map((t) => ({
      name: t.name.slice(0, 60),
      group: t.group,
      type: t.type,
      priority: t.priority,
      progress: t.progress,
      due: t.due,
      from: t.sourceText,
      hasFeedback: t.feedback.length > 0,
    })),
    misplacedDone,
    missingSummary: missingSummary.slice(0, 15),
    todoFieldEntries: todoFields.filter((x) => !x.hasTodo).slice(0, 15),
    staleTodos,
    inbox,
  };
}

/* ---------------- 规划与循环 ---------------- */

function buildPrompt(obs: Record<string, unknown>, level: Level, dry: boolean): string {
  const tools = TOOL_SPECS.map((t) => `- ${t.name}(${t.risk}):${t.desc}`).join("\n");
  return (
    `你是 WorkNote 工作记录库的自主整理 Agent。目标:保持库整洁一致——收件箱不隔夜、` +
    `当日概要不缺、记录里的待办在 todo.md 有对应条目、已完成条目归位、重复待办合并、滞留待办补优先级/预计完成。\n` +
    `规则:\n` +
    `1. 只处理观察数据与检索结果里确凿的内容,不确定就跳过,禁止臆造名称或路径。\n` +
    `2. 任何写操作前先 search 验证(尤其合并前必须确认两条确属同一事项)。\n` +
    `3. 收件箱归档要判断项目归属(按内容与系统名),拿不准就留给人工(不归档)。\n` +
    `4. 黄色工具(merge_todo/edit_todo_meta)只在把握充分时调用,系统会转人工确认。待办数字进度仅凭用户明确给出的百分比或明确完成/取消事实提出 progress 修改,禁止按措辞、模块进度、附件或滞留时间推测。0..99 未完成,100 已完成;取消完成用0。所有待办进度变更都用黄色 edit_todo_meta,不提供独立完成工具;绿色补建 create_todo_from_entry 固定0。记录 entries[].progress 是「进展」正文字符串,不可当成待办数字进度改写。合并仅保留 keep 的状态与进度,不可取两项最大值。\n` +
    `5. 每轮只输出一个 JSON,不要输出其他文字:\n` +
    `   {"thought":"一句话理由","action":{"tool":"工具名","args":{...}}}\n` +
    `6. 全部完成或无可做的事时输出:{"thought":"...","action":{"tool":"finish","args":{"summary":"中文总结:做了什么/建议人工做什么"}}}\n` +
    `可用工具:\n${tools}\n\n` +
    `当前级别:${level}${dry ? "(dry 模式:所有写操作只记录为建议,不执行)" : level === "L1" ? "(写操作只记录为建议)" : "(绿色自动执行,黄色转人工)"}\n` +
    `观察数据(JSON):\n${JSON.stringify(obs).slice(0, 6000)}`
  );
}

/** 带重试的 AI 调用(网关偶发超时/抖动不击穿运行)。 */
async function rawChatRetry(msgs: { role: "user" | "assistant"; content: string }[], tries = 3): Promise<string> {
  let lastErr: unknown = null;
  for (let i = 0; i < tries; i++) {
    try {
      return await rawChat(msgs, 1000);
    } catch (e) {
      lastErr = e;
      const aborted = e instanceof Error && e.name === "AbortError";
      console.error(`[agent] AI 调用失败(第 ${i + 1}/${tries} 次):${aborted ? "超时" : e instanceof Error ? e.message : String(e)}`);
      if (i < tries - 1) await new Promise((r) => setTimeout(r, 5000 * (i + 1)));
    }
  }
  throw lastErr;
}

/** 从模型输出解析动作 JSON(容错:抓取首个平衡的大括号段)。 */
function parseAction(text: string): { thought: string; tool: string; args: Record<string, unknown> } | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const j = JSON.parse(body.slice(start, end + 1)) as {
      thought?: unknown;
      action?: { tool?: unknown; args?: unknown };
    };
    const tool = typeof j.action?.tool === "string" ? j.action.tool.trim() : "";
    if (!tool) return null;
    return {
      thought: typeof j.thought === "string" ? j.thought.slice(0, 200) : "",
      tool,
      args: (j.action?.args ?? {}) as Record<string, unknown>,
    };
  } catch {
    return null;
  }
}

/* ---------------- 主流程 ---------------- */

async function run(level: Level, dry: boolean): Promise<RunResult> {
  const started = Date.now();
  const id = nowStamp().replace(/[-: ]/g, "").slice(0, 12); // YYYYMMDDHHmm
  const result: RunResult = {
    id,
    level,
    dry,
    startedAt: nowStamp(),
    durationMs: 0,
    steps: [],
    executed: 0,
    suggested: 0,
    pendingReview: [],
    finalSummary: "",
    validationOk: false,
    rolledBack: false,
    aiUsed: false,
  };

  const obs = observe();
  console.log(`[agent] 运行 ${id} 级别 ${level}${dry ? "(dry)" : ""};观察:开放待办 ${obs.openTodos === undefined ? "?" : (obs.openTodos as unknown[]).length},收件箱 ${(obs.inbox as unknown[]).length},概要缺失 ${(obs.missingSummary as unknown[]).length},缺口候选 ${(obs.todoFieldEntries as unknown[]).length}`);

  // L1/dry 无需快照也不写数据；L2 自动写入必须先成功取得独立数据根快照。
  let snapSha = "";
  if (level === "L2" && !dry) {
    const snap = snapshotData(ROOT, `chore: agent snapshot ${id}`);
    if (!snap.ok) {
      result.finalSummary = `L2 自动整理未执行：${snap.error}。可改用 L1 或 --dry 仅查看建议。`;
      result.validationOk = true;
      finish(result, started, "", true);
      return result;
    }
    snapSha = snap.sha;
    console.log(`[agent] 数据快照 ${snapSha.slice(0, 10)}`);
  }

  if (!aiConfigured()) {
    // AI 不可用:退化为确定性观察报告(不执行任何写操作)
    result.finalSummary = `AI 未配置,仅输出观察报告:开放待办 ${(obs.openTodos as unknown[]).length} 条,收件箱 ${(obs.inbox as unknown[]).length} 条,概要缺失 ${(obs.missingSummary as unknown[]).length} 天,待办缺口候选 ${(obs.todoFieldEntries as unknown[]).length} 条,未完成区滞留已完成 ${(obs.misplacedDone as unknown[]).length} 条。`;
    result.validationOk = true; // 未改动
    finish(result, started, snapSha, true);
    return result;
  }
  result.aiUsed = true;

  const messages: { role: "user" | "assistant"; content: string }[] = [
    { role: "user", content: buildPrompt(obs, level, dry) },
  ];

  let parseFails = 0;
  try {
  for (let n = 1; n <= MAX_STEPS; n++) {
    if (Date.now() - started > MAX_SECONDS * 1000) {
      result.steps.push({ n, thought: "超时", tool: "abort", args: {}, risk: "green", executed: false, ok: false, summary: `超过 ${MAX_SECONDS / 60} 分钟,停止` });
      break;
    }
    const out = await rawChatRetry(messages);
    const action = parseAction(out);
    if (!action) {
      parseFails += 1;
      messages.push({ role: "assistant", content: out.slice(0, 500) });
      messages.push({ role: "user", content: "输出不是合法的 JSON 动作,请严格按协议重试,只输出一个 JSON 对象。" });
      if (parseFails > MAX_PARSE_FAILS) {
        result.steps.push({ n, thought: "连续解析失败", tool: "abort", args: {}, risk: "green", executed: false, ok: false, summary: `连续 ${parseFails} 次输出无法解析,停止` });
        break;
      }
      continue;
    }
    parseFails = 0;
    messages.push({ role: "assistant", content: JSON.stringify({ thought: action.thought, action: { tool: action.tool, args: action.args } }).slice(0, 800) });

    if (action.tool === "finish") {
      result.finalSummary = typeof action.args.summary === "string" ? action.args.summary : "(未给总结)";
      break;
    }

    const spec = TOOL_SPECS.find((t) => t.name === action.tool);
    const risk: Risk = spec?.risk ?? "green";
    const isWrite = WRITE_TOOLS.has(action.tool);
    const autoExec = !dry && !!snapSha && allowsAuto(risk, level);

    let step: Step;
    if (!isWrite) {
      // 只读工具任何级别都执行(供继续观察)
      const r = runTool(action.tool, action.args);
      step = { n, thought: action.thought, tool: action.tool, args: action.args, risk, executed: true, ok: r.ok, summary: r.summary };
    } else if (autoExec) {
      const r = runTool(action.tool, action.args);
      step = { n, thought: action.thought, tool: action.tool, args: action.args, risk, executed: true, ok: r.ok, summary: r.summary };
      result.executed += 1;
    } else if (risk === "yellow" && !dry && level === "L2") {
      // 黄色:转人工确认队列
      result.pendingReview.push({ tool: action.tool, args: action.args, thought: action.thought });
      step = { n, thought: action.thought, tool: action.tool, args: action.args, risk, executed: false, ok: true, summary: "已转人工确认队列(黄色操作不自动执行)" };
    } else {
      // dry / L1:记录为建议
      result.suggested += 1;
      step = { n, thought: action.thought, tool: action.tool, args: action.args, risk, executed: false, ok: true, summary: "记录为建议(当前级别不执行)" };
    }
    result.steps.push(step);
    messages.push({ role: "user", content: `工具结果(${step.tool},${step.ok ? "成功" : "失败"}):${step.summary.slice(0, 600)}` });

    // 控制上下文:保留首轮 prompt + 最近 16 轮
    if (messages.length > 34) {
      messages.splice(1, messages.length - 34);
    }
    console.log(`[agent] 步骤 ${n}:${step.tool} ${step.ok ? "✔" : "✖"} ${step.summary.slice(0, 100).replace(/\n/g, " ")}`);
  }

  } catch (e) {
    result.steps.push({ n: result.steps.length + 1, thought: "AI 不可用", tool: "abort", args: {}, risk: "green", executed: false, ok: false, summary: `AI 调用连续失败,提前收尾:${e instanceof Error ? e.message : String(e)}` });
  }

  if (!result.finalSummary) {
    result.finalSummary = `提前收尾:已执行 ${result.executed} 项,建议 ${result.suggested} 项,转人工 ${result.pendingReview.length} 项。`;
  }

  // 终检:执行过写操作才跑校验并决定是否回滚
  if (result.executed > 0) {
    const v = runTool("validate", {});
    result.validationOk = v.ok;
    if (!v.ok) {
      if (snapSha) {
        const rb = restoreDataSnapshot(ROOT, snapSha);
        result.rolledBack = rb.ok;
        console.error(`[agent] 校验失败,${rb.ok ? "已回滚到数据快照" : `回滚失败:${rb.error?.slice(0, 200)}`}`);
      }
      result.finalSummary = `校验失败${result.rolledBack ? "，已回滚" : "，请人工检查"}。${result.finalSummary}`;
    } else {
      const saved = snapshotData(ROOT, `chore: agent run ${id}`);
      if (!saved.ok) console.error(saved.error);
    }
  } else {
    result.validationOk = true;
  }

  finish(result, started, snapSha, false);
  return result;
}

/** 写运行日志(md + json)并推送通知。 */
function finish(r: RunResult, started: number, _snapSha: string, _noChange: boolean): void {
  r.durationMs = Date.now() - started;
  const dir = join(ROOT, "agent", "runs");
  mkdirSync(dir, { recursive: true });

  const md: string[] = [];
  md.push(`# 整理 Agent 运行 ${r.startedAt}`, "");
  md.push(`- 级别:${r.level}${r.dry ? "(dry)" : ""} · 用时 ${(r.durationMs / 1000).toFixed(0)}s · 步骤 ${r.steps.length} · AI ${r.aiUsed ? "已用" : "未用"}`);
  md.push(`- 执行 ${r.executed} 项 · 建议未执行 ${r.suggested} 项 · 转人工 ${r.pendingReview.length} 项 · 校验 ${r.validationOk ? "通过" : "失败"}${r.rolledBack ? " · 已回滚" : ""}`);
  md.push("", "## 总结", "", r.finalSummary, "");
  if (r.pendingReview.length) {
    md.push("## 待人工确认(黄色操作)", "");
    for (const p of r.pendingReview) {
      md.push(`- **${p.tool}** \`${JSON.stringify(p.args).slice(0, 200)}\`${p.thought ? ` —— ${p.thought}` : ""}`);
    }
    md.push("");
  }
  md.push("## 执行记录", "");
  for (const s of r.steps) {
    md.push(`### ${s.n}. ${s.tool}(${s.risk}${s.executed ? ",已执行" : ",未执行"})`);
    if (s.thought) md.push(`理由:${s.thought}`);
    if (Object.keys(s.args).length) md.push(`参数:\`${JSON.stringify(s.args).slice(0, 300)}\``);
    md.push(`结果:${s.ok ? "成功" : "失败"} —— ${s.summary.replace(/\n/g, " ").slice(0, 300)}`);
    md.push("");
  }
  writeFileSync(join(dir, `${r.id}.md`), md.join("\n"), { mode: 0o644 });
  writeFileSync(join(dir, `${r.id}.json`), JSON.stringify(r, null, 2), { mode: 0o644 });

  console.log(`[agent] 日志: agent/runs/${r.id}.md`);

  if (notifyConfigured()) {
    const status = r.validationOk ? "✅" : "✖";
    const lines = [
      `## ${status} 整理 Agent 报告`,
      "",
      `**${r.finalSummary.slice(0, 200)}**`,
      "",
      `> 执行 **${r.executed}** · 建议 **${r.suggested}** · 转人工 **${r.pendingReview.length}** · 用时 **${(r.durationMs / 1000).toFixed(0)}s**`,
      "",
      ...(r.pendingReview.length
        ? [`<font color="warning">**⚠️ 待人工确认 ${r.pendingReview.length} 项:**</font>`]
            .concat(r.pendingReview.map((p) => `> ${p.tool}: ${JSON.stringify(p.args).slice(0, 80)}`))
            .concat([""])
        : []),
      `<font color="comment">日志: agent/runs/${r.id}.md</font>`,
    ];
    void sendNotify(`WorkNote 整理 Agent ${r.id}`, lines, undefined, true);
  }
}

/* ---------------- 入口 ---------------- */

function listRecentRuns(limit = 20): { id: string; file: string }[] {
  const dir = join(ROOT, "agent", "runs");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .reverse()
    .slice(0, limit)
    .map((f) => ({ id: f.replace(".json", ""), file: f }));
}

/** 供 API 复用:读取最近运行摘要。 */
export function recentRuns(limit = 20): unknown[] {
  const dir = join(ROOT, "agent", "runs");
  return listRecentRuns(limit).map(({ id }) => {
    try {
      const j = JSON.parse(readFileSync(join(dir, `${id}.json`), "utf-8")) as Partial<RunResult>;
      return {
        id,
        startedAt: j.startedAt,
        level: j.level,
        dry: j.dry,
        executed: j.executed ?? 0,
        suggested: j.suggested ?? 0,
        pendingReview: j.pendingReview?.length ?? 0,
        validationOk: j.validationOk,
        rolledBack: j.rolledBack,
        summary: (j.finalSummary ?? "").slice(0, 200),
      };
    } catch {
      return { id, error: "读取失败" };
    }
  });
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);  let level: Level | null = null;
  let dry = false;
  let useConfig = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--run") useConfig = true;
    else if (a === "--level") {
      const v = argv[++i];
      if (v !== "L1" && v !== "L2") {
        console.error("--level 只能是 L1 或 L2");
        process.exit(1);
      }
      level = v;
    } else if (a === "--dry") dry = true;
    else {
      console.error(`未知参数: ${a}`);
      process.exit(1);
    }
  }

  const cfgLevel = readConfig().agentLevel ?? "off";
  if (level === null || useConfig) {
    if (cfgLevel === "off") {
      console.log("[agent] Agent 缺省关闭，跳过；可显式 --level L1 查看建议");
      return;
    }
    level = cfgLevel;
  }

  const r = await run(level, dry);
  if (!r.validationOk) process.exit(1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(`[agent] 运行异常终止: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  });
}
