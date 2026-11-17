/**
 * AI 封装:调 OpenAI 兼容网关。
 *
 * 用途:① 解析用户贴的文字/图片 -> 结构化待办;② 整理完成情况文字;
 *      ③ 基于检索资料回答关于记录/待办的问题(AI 问答);④ 起草当日概要。
 * 设计原则:AI 失败不能阻断主流程——解析失败就降级返回原文,绝不抛到调用方。
 * (问答与概要起草为显式 AI 功能,失败时如实抛错由接口转 502。)
 *
 * 配置可运行时修改,优先级:site-config.json 的 ai 段(站点「设置」页写入)
 * > 环境变量 WORKNOTE_AI_URL/KEY/MODEL(可从 .env 加载)。
 * 每次 AI 调用现读配置,改完即时生效,无需重启服务或 CLI。
 */

import { TYPE_ORDER } from "./parser.js";
import { readConfig, updateConfig, type AiConfigOverride } from "./site-config.js";

const TIMEOUT_MS = 180_000;

export type { AiConfigOverride };

/** AI 覆盖配置(site-config.json 的 ai 段)。 */
export function readAiOverride(): AiConfigOverride {
  return readConfig().ai ?? {};
}

/** 合并保存 AI 覆盖段。 */
export function saveAiOverride(patch: AiConfigOverride): AiConfigOverride {
  const next = updateConfig((c) => ({ ...c, ai: { ...(c.ai ?? {}), ...patch } }));
  return next.ai ?? {};
}

/** 清除 AI 覆盖段,回落到环境变量配置。 */
export function clearAiOverride(): void {
  updateConfig((c) => {
    const { ai: _ai, ...rest } = c;
    return rest;
  });
}

function effUrl(override: AiConfigOverride): string {
  return (override.url ?? process.env.WORKNOTE_AI_URL ?? "")
    .trim()
    .replace(/\/+$/, "");
}
function effKey(override: AiConfigOverride): string {
  return (override.key ?? process.env.WORKNOTE_AI_KEY ?? "").trim();
}
function effModel(override: AiConfigOverride): string {
  return (override.model ?? process.env.WORKNOTE_AI_MODEL ?? "").trim();
}

export function aiConfigured(): boolean {
  const config = readAiOverride();
  return effKey(config).length > 0 && effUrl(config).length > 0 && effModel(config).length > 0;
}

export function aiModel(): string {
  return effModel(readAiOverride());
}

/** 当前生效配置(供设置页展示;密钥打码)。 */
export function aiEffectiveConfig(): {
  configured: boolean;
  url: string;
  model: string;
  keyMasked: string;
  source: "override" | "env";
} {
  const o = readAiOverride();
  const key = effKey(o);
  const hasOverride = o.url !== undefined || o.key !== undefined || o.model !== undefined;
  return {
    configured: aiConfigured(),
    url: effUrl(o),
    model: effModel(o),
    keyMasked: maskKey(key),
    source: hasOverride ? "override" : "env",
  };
}

/** 密钥打码(不回传明文)。 */
export function maskKey(key: string): string {
  return !key ? "" : key.length <= 8 ? "****" : `${key.slice(0, 3)}****${key.slice(-4)}`;
}

type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

/** 按给定(或当前生效)配置调网关;models/test 接口与正式调用共用一条通路。 */
async function callGateway(
  path: string,
  init: RequestInit,
  cfg?: { url?: string; key?: string },
  timeoutMs = TIMEOUT_MS,
): Promise<Response> {
  const o = cfg ? { ...readAiOverride(), ...cfg } : readAiOverride();
  const url = (cfg?.url ?? effUrl(o)).replace(/\/+$/, "");
  const key = (cfg?.key ?? effKey(o)).trim();
  if (!key) throw new Error("未配置密钥");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(`${url}${path}`, {
      ...init,
      signal: ctrl.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
        ...(init.headers ?? {}),
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

async function chat(messages: unknown[], maxTokens = 1200): Promise<string> {
  if (!aiConfigured()) throw new Error("未配置 AI(WORKNOTE_AI_KEY)");
  const o = readAiOverride();
  const model = effModel(o);
  const res = await callGateway("/v1/chat/completions", {
    method: "POST",
    body: JSON.stringify({
      model,
      messages,
      // 推理型模型(如 glm-5.3)会先消耗思考 token 再输出正文,
      // 预算太小会只得到空 content(finish_reason=length),故设下限
      max_tokens: Math.max(maxTokens, 1600),
      stream: false,
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`AI 网关返回 ${res.status} ${t.slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  return data.choices?.[0]?.message?.content?.trim() ?? "";
}

/** 拉取网关模型列表(设置页下拉用);cfg 可传未保存的地址/密钥先行验证。 */
export async function fetchAiModels(cfg?: { url?: string; key?: string }): Promise<string[]> {
  const res = await callGateway("/v1/models", { method: "GET" }, cfg, 15_000);
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`网关返回 ${res.status} ${t.slice(0, 160)}`);
  }
  const data = (await res.json()) as { data?: { id?: string }[] };
  const ids = (data.data ?? []).map((m) => (m.id ?? "").trim()).filter(Boolean);
  return [...new Set(ids)].sort((a, b) => a.localeCompare(b));
}

/** 用给定(或当前)配置发一条最小测试请求,返回耗时与回复。 */
export async function testAi(
  cfg?: { url?: string; key?: string; model?: string },
): Promise<{ ms: number; reply: string }> {
  const o = cfg ? { ...readAiOverride(), ...cfg } : readAiOverride();
  const model = (cfg?.model ?? effModel(o)).trim();
  if (!model) throw new Error("未指定模型");
  const started = Date.now();
  const res = await callGateway(
    "/v1/chat/completions",
    {
      method: "POST",
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "连通性测试,请只回复两个字:正常" }],
        max_tokens: 1600,
        stream: false,
      }),
    },
    cfg,
    60_000,
  );
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`网关返回 ${res.status} ${t.slice(0, 160)}`);
  }
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const reply = data.choices?.[0]?.message?.content?.trim() ?? "";
  if (!reply) throw new Error("模型返回为空(可能为推理型模型预算耗尽)");
  return { ms: Date.now() - started, reply: reply.slice(0, 50) };
}

/** 从模型输出里抠出 JSON(容忍 ```json 包裹与前后废话)。 */
function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("未找到 JSON");
  return JSON.parse(body.slice(start, end + 1));
}

/** 通用对话入口(整理 Agent 的自主循环用;失败如实抛错)。 */
export async function rawChat(
  messages: { role: "user" | "assistant"; content: string }[],
  maxTokens = 1500,
): Promise<string> {
  return chat(
    messages.map((m) => ({ role: m.role, content: [{ type: "text" as const, text: m.content }] })),
    maxTokens,
  );
}

export interface AiTodoDraft {
  name: string;
  note: string;
  type: string;
  projectName: string;
  /** AI 没把握时为 true,前端应提示用户确认。 */
  degraded: boolean;
}

/** 艾整理完成情况:输入原始描述+图片,输出条理化的一段完成说明。 */
export async function analyzeCompletion(
  raw: string,
  images: string[],
  context: { name: string; projectName: string },
): Promise<{ text: string; degraded: boolean }> {
  const parts: ContentPart[] = [
    {
      type: "text",
      text:
        `你是工作记录助手。下面是用户对某条待办「${context.name}」(${context.projectName})的完成情况描述` +
        `(可能包含图片)。请整理成一段简洁、书面、客观的完成说明,直接写结论与结果,不要客套话、不要 Markdown 标题。` +
        `若有图片,请把图中关键信息(界面/数据/结果)也概括进去。只输出整理后的文字本身。\n\n原始描述:\n${raw || "(无文字,见图片)"}`,
    },
    ...images.map((url) => ({ type: "image_url" as const, image_url: { url } })),
  ];
  try {
    const out = await chat([{ role: "user", content: parts }], 800);
    if (!out) throw new Error("空响应");
    return { text: out, degraded: false };
  } catch {
    // 降级:用原文,不让 AI 阻断
    return { text: raw.trim(), degraded: true };
  }
}

/** 解析用户贴的文字/图片 -> 结构化待办草稿。 */
export async function analyzeTodoInput(
  raw: string,
  images: string[],
  ctx: { projects: { slug: string; name: string; systems: string[] }[] },
): Promise<AiTodoDraft> {
  const projectList = ctx.projects.map((p) => `${p.name}(系统:${p.systems.join("、") || "未标注"})`).join(";");
  const prompt =
    `你是工作记录助手。请把用户提供的内容(文字/图片)整理成**一条待办**,输出严格 JSON,不要多余文字。\n` +
    `字段:\n` +
    `  name: 事项名(简短,一句话,不含说明)\n` +
    `  note: 补充说明(可空字符串)\n` +
    `  type: 必须是以下之一:${TYPE_ORDER.join(" / ")}\n` +
    `  projectName: 归属项目,必须从以下列表中选最贴近的一个:${projectList}\n` +
    `只输出 JSON,例如 {"name":"...","note":"...","type":"需求","projectName":"示例项目"}\n\n` +
    `用户内容:\n${raw || "(无文字,见图片)"}`;
  const parts: ContentPart[] = [
    { type: "text", text: prompt },
    ...images.map((url) => ({ type: "image_url" as const, image_url: { url } })),
  ];
  try {
    const out = await chat([{ role: "user", content: parts }], 600);
    const j = extractJson(out) as Partial<AiTodoDraft>;
    const name = (j.name ?? "").toString().trim();
    if (!name) throw new Error("缺少 name");
    const type = TYPE_ORDER.includes(j.type as (typeof TYPE_ORDER)[number]) ? (j.type as string) : "";
    const projectName =
      ctx.projects.find((p) => p.name === j.projectName)?.name ?? ctx.projects[0]?.name ?? "";
    return {
      name,
      note: (j.note ?? "").toString().trim(),
      type: type || TYPE_ORDER[0],
      projectName,
      degraded: false,
    };
  } catch {
    // 降级:把原文当作事项名,项目留空由用户选
    return {
      name: raw.trim().slice(0, 60) || "未命名待办",
      note: raw.trim(),
      type: TYPE_ORDER[0],
      projectName: "",
      degraded: true,
    };
  }
}

/** AI 问答:仅依据检索到的资料回答,不臆造;失败如实抛错。 */
export async function askRecords(question: string, context: string): Promise<string> {
  const prompt =
    `你是工作记录助手。请**仅依据**下面的资料回答用户问题;资料里没有的内容直接说明"记录里没查到",` +
    `不要编造;引用信息时带上日期与项目名;用简洁的中文短段落或分点作答。\n\n` +
    `【资料】\n${context}\n\n【问题】${question}`;
  const out = await chat([{ role: "user", content: [{ type: "text", text: prompt }] }], 1200);
  if (!out) throw new Error("AI 返回为空");
  return out;
}

/** 起草当日概要:根据当日条目写一句话总结(≤60 字),供 record summary 使用。 */
export async function draftDaySummary(day: {
  date: string;
  project: string;
  entries: { time: string; title: string; type: string; module: string; content: string }[];
}): Promise<string> {
  const lines = day.entries
    .map((e) => `- [${e.time}] ${e.title}(${e.type}${e.module ? "/" + e.module : ""}):${e.content.slice(0, 120)}`)
    .join("\n");
  const prompt =
    `请根据 ${day.date} 「${day.project}」的以下工作条目,写一句话当日工作概要` +
    `(不超过 60 个汉字,概括主要事项与结论,不要客套话,直接输出概要文字本身,不要引号):\n${lines}`;
  const out = await chat([{ role: "user", content: [{ type: "text", text: prompt }] }], 200);
  if (!out) throw new Error("AI 返回为空");
  return out.replace(/^["“]|["”]$/g, "").trim();
}