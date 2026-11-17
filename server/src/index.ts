/**
 * WorkNote 后端 API。
 *
 * 写路径有三条,都写进 todo.md(逐条最小改动 + 原子写):
 * 1. 登录后手动/AI 新建待办;
 * 2. 登录后勾选完成并写入完成情况;
 * 3. 分享链接(mode=edit)勾选该项目待办。
 * 每日工作记录(projects/)仍只由记录流程(助手)写入。
 */

import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { execFileSync } from "node:child_process";
import { existsSync, createReadStream, mkdirSync, writeFileSync, rmSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import { isIP } from "node:net";
import { dataRoot, sourceRoot } from "./environment.js";
import { renderMarkdown } from "./render-markdown.js";
import {
  collect,
  parseTodo,
  resolveAttachment,
  searchEntries,
  searchTodos,
  listDaySummaries,
  PRIORITY_ORDER,
  TYPE_ORDER,
  type Project,
  type TodoItem,
} from "./parser.js";

import {
  authConfigured,
  checkPassword,
  issueSession,
  verifySession,
  readSessionCookie,
  sessionCookie,
  clearCookie,
  tooManyAttempts,
  recordFailure,
  clearFailures,
} from "./auth.js";
import { listShares, findByToken, createShare, revokeShare, updateShare, type ShareMode } from "./shares.js";
import { markTodoDone, markTodoUndone, appendFeedback, setFeedbackReply, updateTodo, deleteTodo } from "./todo-write.js";
import { createTodo } from "./todo-create.js";
import { isTodoProgress, todoNameError } from "./todo-format.js";
import { saveImages, type SavedImage } from "./attachments-write.js";
import { appendDayCompletion } from "./daylog-write.js";
import {
  aiConfigured,
  aiModel,
  analyzeTodoInput,
  analyzeCompletion,
  askRecords,
  aiEffectiveConfig,
  fetchAiModels,
  testAi,
} from "./ai.js";
import { getOrGenerateThumbnail, DEFAULT_THUMB_WIDTH } from "./thumbnail.js";
import { listInbox, appendInboxItem, deleteInboxItem, saveInboxImages, inboxFile } from "./inbox.js";
import { buildReport } from "./report.js";
import { sendNotify, sendNotifyDetailed, notifyWebhook } from "./notify.js";
import { readConfig, updateConfig } from "./site-config.js";
import { recentRuns } from "./agent.js";
import { listModules, upsertModule, upsertSub, deleteModule, MODULE_STATUSES, type ModuleStatus } from "./modules.js";

const ROOT = dataRoot();

const PORT = Number(process.env.PORT ?? 8000);
const HOST = process.env.HOST ?? "127.0.0.1";

/** Only explicitly trusted IPs/CIDRs may supply proxy headers; direct deployments trust none. */
function trustedProxies(): false | string[] {
  const raw = process.env.WORKNOTE_TRUST_PROXY?.trim();
  if (!raw) return false;
  const proxies = raw.split(",").map((value) => value.trim());
  for (const proxy of proxies) {
    const [address, bits, extra] = proxy.split("/");
    const family = isIP(address);
    if (!family || extra !== undefined || (bits !== undefined && (!/^\d+$/.test(bits) || Number(bits) > (family === 4 ? 32 : 128)))) {
      throw new Error("WORKNOTE_TRUST_PROXY 只能是可信代理 IP/CIDR 的逗号分隔列表，不能使用 true 或通配符");
    }
  }
  return proxies;
}

// Disable automatic request logs so share tokens and request bodies cannot enter logs.
const app = Fastify({ logger: { level: "info" }, disableRequestLogging: true, trustProxy: trustedProxies(), bodyLimit: 30 * 1024 * 1024 });
app.setErrorHandler((error, _req, reply) => {
  const typed = error as { statusCode?: number; message?: string };
  const status = typed.statusCode && typed.statusCode >= 400 ? typed.statusCode : 500;
  return reply.code(status).send({ error: status >= 500 ? "服务处理失败，请检查数据配置" : typed.message || "请求不合法" });
});

/** 每次请求现读现解析。记录量小(几十 KB),这样编辑 Markdown 后立即可见。 */
function loadProjects(): Project[] {
  return collect(ROOT);
}

/** 给条目里的附件补上站点绝对路径,并渲染 block 的 HTML(仅行内+简单块级 markdown)。 */
function hydrate(p: Project) {
  return {
    ...p,
    days: p.days.map((d) => ({
      ...d,
      entries: d.entries.map((e) => ({
        ...e,
        blocks: e.blocks.map((b) => ({
          ...b,
          html: renderMarkdown(b.text),
          imageUrls: b.images.map((im) => ({
            alt: im.alt,
            url: resolveAttachment(im.src, p.slug, d.date),
          })),
        })),
      })),
    })),
  };
}

/* ---------------- 鉴权 ---------------- */

/** 当前请求是否为已登录会话。 */
function isAuthed(req: { headers: { cookie?: string } }): boolean {
  return verifySession(readSessionCookie(req.headers.cookie));
}

/** 公开路由前缀:不需要登录。 */
const PUBLIC_API = ["/api/health", "/api/login", "/api/logout", "/api/me", "/api/overview"];

app.addHook("preHandler", async (req, reply) => {
  const url = req.url.split("?")[0];
  // 附件与分享链接走各自逻辑(分享凭 token 免登录)
  if (url.startsWith("/attachments/")) {
    if (!isAuthed(req)) return reply.code(401).send({ error: "需要登录" });
    return;
  }
  if (url.startsWith("/api/share/")) return;
  if (PUBLIC_API.some((p) => url === p || url.startsWith(p + "/"))) return;
  if (!url.startsWith("/api/")) return;
  if (!isAuthed(req)) return reply.code(401).send({ error: "需要登录" });
});

app.get("/api/health", async () => ({ ok: true }));

app.get("/api/me", async (req, reply) => {
  if (!authConfigured()) return { authed: false, configured: false };
  const authed = isAuthed(req);
  if (authed) return { authed: true, configured: true };
  // 会话失效时顺手清掉过期 cookie
  reply.header("Set-Cookie", clearCookie());
  return { authed: false, configured: true };
});

app.post("/api/login", async (req, reply) => {
  if (!authConfigured()) {
    return reply.code(503).send({ error: "未配置登录口令(缺少 WORKNOTE_PASSWORD/SECRET)" });
  }
  const ip = req.ip;
  if (tooManyAttempts(ip)) {
    return reply.code(429).send({ error: "尝试过于频繁,请稍后再试" });
  }
  const body = (req.body ?? {}) as { password?: unknown };
  if (!checkPassword(body.password)) {
    recordFailure(ip);
    return reply.code(401).send({ error: "口令不正确" });
  }
  clearFailures(ip);
  reply.header("Set-Cookie", sessionCookie(issueSession(), 30 * 24 * 60 * 60));
  return { ok: true };
});

app.post("/api/logout", async (_req, reply) => {
  reply.header("Set-Cookie", clearCookie());
  return { ok: true };
});

/* ---------------- 附件 ---------------- */

const ATTACHMENT_FILE = /^[a-zA-Z0-9][a-zA-Z0-9._-]*\.(?:png|jpe?g|gif|webp|avif)$/i;
const PROJECT_SLUG = /^[a-z0-9][a-z0-9_-]*$/;

function validDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

function within(base: string, path: string): boolean {
  const rel = relative(base, path);
  return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

/** Strict image paths plus canonical per-level bounds, so sibling prefixes/symlinks cannot escape. */
function attachmentFile(slug: string, date: string, file: string): string | null {
  if (!PROJECT_SLUG.test(slug) || ["constructor", "prototype"].includes(slug) || !validDate(date) || !ATTACHMENT_FILE.test(file) || file.includes("..")) return null;
  try {
    const root = realpathSync(ROOT);
    const projects = realpathSync(join(root, "projects"));
    const project = realpathSync(join(projects, slug));
    const daily = realpathSync(join(project, "daily"));
    const month = realpathSync(join(daily, date.slice(0, 7)));
    const day = realpathSync(join(month, date));
    const attachments = realpathSync(join(day, "attachments"));
    const path = realpathSync(join(attachments, file));
    // Reject aliases even inside the same data tree: one project must never resolve to another.
    if (projects !== join(root, "projects") || project !== join(projects, slug) || daily !== join(project, "daily") ||
        month !== join(daily, date.slice(0, 7)) || day !== join(month, date) || attachments !== join(day, "attachments") ||
        path !== join(attachments, file) || !statSync(path).isFile()) return null;
    return path;
  } catch {
    return null;
  }
}

/** Attachments use /attachments/<registered project>/<date>/<single image filename>. */
app.get("/attachments/:slug/:date/:file", async (req, reply) => {
  const { slug, date, file } = req.params as { slug: string; date: string; file: string };
  if (!loadProjects().some((p) => p.slug === slug)) return reply.code(404).send({ error: "项目不存在" });
  const path = attachmentFile(slug, date, file);
  if (!path) return reply.code(404).send({ error: "附件不存在或路径不合法" });

  const query = (req.query ?? {}) as { thumb?: string; w?: string };
  const isThumb = query.thumb === "1" || query.thumb === "true" || !!query.w;
  if (isThumb) {
    const width = Math.min(1200, Math.max(80, Number(query.w) || DEFAULT_THUMB_WIDTH));
    const res = await getOrGenerateThumbnail(ROOT, path, width);
    reply.header("Content-Type", res.mime);
    reply.header("Cache-Control", "private, max-age=2592000, immutable");
    return reply.send(createReadStream(res.path));
  }

  const ext = file.split(".").pop()?.toLowerCase() ?? "";
  const mime: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    avif: "image/avif",
  };
  reply.header("Content-Type", mime[ext] ?? "application/octet-stream");
  reply.header("Cache-Control", "private, max-age=86400");
  return reply.send(createReadStream(path));
});

/* ---------------- 总览(公开) ---------------- */

/** 首页总览:统计 + 最近记录流 + 项目卡片。未登录只给统计与项目名。 */
app.get("/api/overview", async (req) => {
  const authed = isAuthed(req);
  const projects = loadProjects().map(hydrate);
  const todo = parseTodo(join(ROOT, "todo.md"));
  const days = projects
    .flatMap((p) => p.days.map((d) => ({ ...d, projectSlug: p.slug, projectName: p.name })))
    .sort((a, b) => (a.date < b.date ? 1 : -1));

  const counts: Record<string, number> = {};
  for (const p of projects)
    for (const [k, v] of Object.entries(p.counts)) counts[k] = (counts[k] ?? 0) + v;

  return {
    typeOrder: TYPE_ORDER,
    authed,
    projectCount: projects.length,
    entryCount: projects.reduce((s, p) => s + p.entryCount, 0),
    // 全库不同日历天数(跨项目去重,同一天多个项目只算 1 天;
    // 与 /api/records 的 dayCount 语义一致,不能用 days.length 求和——会重复计数)
    dayCount: new Set(days.map((d) => d.date)).size,
    todoOpen: todo.open.length,
    todoDone: todo.done.length,
    counts,
    // 未登录不下发任何记录内容(标题也算内容)
    recentDays: authed
      ? days.slice(0, 20).map((d) => ({
          slug: d.slug,
          projectSlug: d.projectSlug,
          projectName: d.projectName,
          date: d.date,
          weekday: d.weekday,
          entryCount: d.entries.length,
          entries: d.entries.map((e) => ({
            time: e.time,
            title: e.title,
            module: e.module,
            type: e.type,
            anchor: e.anchor,
          })),
        }))
      : [],
    projects: projects.map((p) => ({
      slug: p.slug,
      name: p.name,
      systems: authed ? p.systems : [],
      dayCount: p.dayCount,
      entryCount: p.entryCount,
      counts: p.counts,
      dateRange: p.dateRange,
    })),
  };
});

/* ---------------- 待办 ---------------- */

/** 待办清单。 */
app.get("/api/todo", async () => {
  const { open, done } = parseTodo(join(ROOT, "todo.md"));
  return {
    priorityOrder: PRIORITY_ORDER,
    typeOrder: TYPE_ORDER,
    open,
    done,
    counts: open.reduce<Record<string, number>>((acc, it) => {
      if (it.type) acc[it.type] = (acc[it.type] ?? 0) + 1;
      return acc;
    }, {}),
    groups: [...new Set(open.map((i) => i.group || "其他"))],
  };
});

/** 按项目分组的待办(供项目页面板阅读,也是分享链接的核心内容)。 */
function todoForGroup(groupName: string) {
  const { open, done } = parseTodo(join(ROOT, "todo.md"));
  // 分组名形如「示例项目 · 示例系统」,以项目显示名为前缀匹配
  const match = (g: string) => g === groupName || g.startsWith(`${groupName} ·`) || g.startsWith(groupName + "·");
  return {
    open: open.filter((i) => match(i.group || "其他")),
    done: done.filter((i) => match(i.group || "其他")),
  };
}

/** 项目显示名 -> 待办分组名的前缀匹配(分组形如「示例项目 · 示例系统」)。 */
function groupPrefix(projectName: string): string {
  return projectName;
}

/* ---------------- 待办:新建 / 完成(需登录) ---------------- */

/** 本地 HHMM(用于附件命名)。 */
function nowHHMM(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}${p(d.getMinutes())}`;
}
/** 本地「YYYY-MM-DD HH:MM」,作为完成时间戳写入行内完成标记。 */
function nowStamp(): string {
  return `${today()} ${nowHHMM().replace(/(\d{2})(\d{2})/, "$1:$2")}`;
}
function today(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 按原身份定位待办;不允许模糊命中多个同名事项。 */
function todoSnapshot(name: string, source?: string) {
  const { open, done } = parseTodo(join(ROOT, "todo.md"));
  const hits = [
    ...open.map((item) => ({ item, done: false })),
    ...done.map((item) => ({ item, done: true })),
  ].filter(({ item }) => item.name === name && (source === undefined || item.source === source));
  return hits.length === 1 ? hits[0] : null;
}

/** 写入成功后返回规范化的进度/分区快照,供所有视图即时归位。 */
function todoMutation(name: string, source: string, previous = { name, source }) {
  const snapshot = todoSnapshot(name, source);
  if (!snapshot) throw new Error("待办已保存但无法唯一定位,请刷新清单核对");
  return { ...snapshot, progress: snapshot.item.progress, previous };
}

/** 当前待办所属项目(分组优先,来源兜底;不接受调用者指定错误项目)。 */
function projectForTodo(item: TodoItem, projects = loadProjects()) {
  const fromGroup = projects.find((p) => item.group === p.name || item.group.startsWith(`${p.name} ·`) || item.group.startsWith(`${p.name}·`));
  return fromGroup ?? projects.find((p) => item.source.startsWith(`projects/${p.slug}/`));
}

/** 登录写入新进入100%时追加当日完成记录;重复保存和分享勾选不调用。 */
function writeTodoCompletion(item: TodoItem, stamp: string, text = "", refs: SavedImage[] = []): boolean {
  const proj = projectForTodo(item);
  if (!proj) return false;
  try {
    appendDayCompletion(ROOT, proj.slug, {
      date: stamp.slice(0, 10),
      time: stamp.slice(11),
      title: `已完成:${item.name}`,
      type: item.type || "修改",
      module: "待办完成",
      content: text || "（进度更新为100%，未填写完成说明）",
      images: refs.map((r) => ({ alt: "完成截图", src: r.rel })),
      sourceNote: `来自待办清单（${proj.name}）`,
      projectName: proj.name,
      systemName: proj.systems[0] || "",
    });
    return true;
  } catch {
    return false; // 日记录失败不撤销已保存的待办,接口如实回报。
  }
}

/** 项目 [] 供 AI 归属判断与前端下拉。 */
function projectOptions() {
  return loadProjects().map((p) => ({ slug: p.slug, name: p.name, systems: p.systems }));
}

/** 将上传的图片落盘并将 Markdown 引用拼接在 note 尾部。 */
function attachImagesToNote(
  slug: string,
  baseNote: string,
  imagesInput: unknown,
): { note: string; refs: SavedImage[] } {
  const images = Array.isArray(imagesInput)
    ? (imagesInput as { dataUrl: string; alt?: string }[])
    : [];
  if (!images.length) return { note: baseNote, refs: [] };
  const refs = saveImages(ROOT, slug, today(), nowHHMM(), images.slice(0, 6));
  const refsMd = refs.map((r) => `![附件](${r.rel})`).join(" ");
  const note = baseNote.trim() ? `${baseNote.trim()} ${refsMd}` : refsMd;
  return { note, refs };
}

/** AI 是否可用(前端据此决定是否显示 AI 页签)。 */
app.get("/api/ai/status", async () => ({ configured: aiConfigured(), model: aiModel() }));

/* ---------------- 站点设置(统一配置,登录即可改,即时生效) ---------------- */

/** Webhook 地址打码(URL 里带 token,只露 origin 与路径开头)。 */
function maskWebhook(url: string): string {
  if (!url) return "";
  try {
    const u = new URL(url);
    const path = u.pathname.length > 8 ? `${u.pathname.slice(0, 8)}****` : u.pathname;
    return `${u.origin}${path}`;
  } catch {
    return "****";
  }
}

/** 当前生效设置汇总(密钥/口令一律打码,不回传明文)。 */
app.get("/api/settings", async () => {
  const cfg = readConfig();
  const ai = aiEffectiveConfig();
  const webhook = notifyWebhook() ?? "";
  const digestTime = cfg.digestTime && /^\d{1,2}:\d{2}$/.test(cfg.digestTime) ? cfg.digestTime : "08:30";
  return {
    ai,
    notify: { configured: !!webhook, webhookMasked: maskWebhook(webhook) },
    digest: { time: digestTime, staleDays: cfg.staleDays ?? 14 },
    password: { overridden: !!cfg.password, source: cfg.password ? "站点覆盖" : "环境变量" },
    agent: { level: cfg.agentLevel ?? "off", systemdEnabled: process.env.WORKNOTE_SYSTEMD === "1" },
    overrideFile: "site-config.json",
  };
});

const SYSTEMD_DISABLED = "未启用 WORKNOTE_SYSTEMD=1，时间已作为配置保存；请由外部调度器运行晨报 CLI";

/** 仅显式启用 systemd 时才写宿主 timer。 */
function applyDigestTimer(time: string): { ok: boolean; error?: string } {
  if (process.env.WORKNOTE_SYSTEMD !== "1") return { ok: false, error: SYSTEMD_DISABLED };
  try {
    const m = time.match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return { ok: false, error: "时间格式需为 HH:MM" };
    const hh = String(Number(m[1])).padStart(2, "0");
    const mm = m[2];
    if (Number(m[1]) > 23 || Number(mm) > 59) return { ok: false, error: "时间超出范围" };
    const dir = "/etc/systemd/system/worknote-digest.timer.d";
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "override.conf"), `[Timer]\nOnCalendar=\nOnCalendar=*-*-* ${hh}:${mm}:00\n`);
    execFileSync("systemctl", ["daemon-reload"]);
    execFileSync("systemctl", ["restart", "worknote-digest.timer"]);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** 恢复默认 08:30(删除 drop-in)。 */
function resetDigestTimer(): { ok: boolean; error?: string } {
  if (process.env.WORKNOTE_SYSTEMD !== "1") return { ok: false, error: SYSTEMD_DISABLED };
  try {
    const f = "/etc/systemd/system/worknote-digest.timer.d/override.conf";
    if (existsSync(f)) rmSync(f);
    try {
      rmSync("/etc/systemd/system/worknote-digest.timer.d", { force: true });
    } catch {
      /* 目录非空时忽略 */
    }
    execFileSync("systemctl", ["daemon-reload"]);
    execFileSync("systemctl", ["restart", "worknote-digest.timer"]);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * 保存设置(只更新给出的字段,写入 site-config.json,即时生效)。
 * 空串语义:notifyWebhook/password 传 "" 表示清除该项回落 env;ai.key 留空表示沿用。
 * reset=true 清空全部站点覆盖并恢复默认晨报时间。
 */
app.post("/api/settings", async (req, reply) => {
  const b = (req.body ?? {}) as {
    ai?: { url?: unknown; key?: unknown; model?: unknown };
    notifyWebhook?: unknown;
    digestTime?: unknown;
    staleDays?: unknown;
    password?: unknown;
    agentLevel?: unknown;
    reset?: unknown;
  };

  if (b.reset === true) {
    updateConfig(() => ({}));
    const timer = resetDigestTimer();
    return { ok: true, timer, timerSynced: timer.ok, ...(timer.error ? { timerMessage: timer.error } : {}) };
  }

  const aiPatch: { url?: string; key?: string; model?: string } = {};
  if (b.ai && typeof b.ai === "object") {
    if (typeof b.ai.url === "string" && b.ai.url.trim()) {
      const url = b.ai.url.trim();
      if (!/^https?:\/\//.test(url)) return reply.code(400).send({ error: "AI 网关地址需以 http(s):// 开头" });
      aiPatch.url = url;
    }
    if (typeof b.ai.key === "string" && b.ai.key.trim()) aiPatch.key = b.ai.key.trim();
    if (typeof b.ai.model === "string" && b.ai.model.trim()) aiPatch.model = b.ai.model.trim();
  }

  const patch: {
    ai?: typeof aiPatch;
    notifyWebhook?: string;
    digestTime?: string;
    staleDays?: number;
    password?: string;
    agentLevel?: "off" | "L1" | "L2";
  } = {};
  if (Object.keys(aiPatch).length) patch.ai = aiPatch;

  if (b.notifyWebhook !== undefined && typeof b.notifyWebhook === "string") {
    const v = b.notifyWebhook.trim();
    if (v && !/^https?:\/\//.test(v)) {
      return reply.code(400).send({ error: "Webhook 地址需以 http(s):// 开头" });
    }
    patch.notifyWebhook = v; // 空串=清除
  }

  let timer: { ok: boolean; error?: string } | null = null;
  if (b.digestTime !== undefined && typeof b.digestTime === "string") {
    const v = b.digestTime.trim();
    if (!/^\d{1,2}:\d{2}$/.test(v) || Number(v.split(":")[0]) > 23 || Number(v.split(":")[1]) > 59) {
      return reply.code(400).send({ error: "晨报时间需为合法的 HH:MM" });
    }
    patch.digestTime = v;
  }

  if (b.staleDays !== undefined) {
    const n = Number(b.staleDays);
    if (!Number.isInteger(n) || n < 3 || n > 90) {
      return reply.code(400).send({ error: "滞留阈值需为 3~90 的整数(天)" });
    }
    patch.staleDays = n;
  }

  if (b.password !== undefined && typeof b.password === "string") {
    const v = b.password;
    if (v && v.length < 6) return reply.code(400).send({ error: "口令至少 6 位" });
    patch.password = v; // 空串=清除回落 env
  }

  if (b.agentLevel !== undefined) {
    if (b.agentLevel !== "off" && b.agentLevel !== "L1" && b.agentLevel !== "L2") {
      return reply.code(400).send({ error: "Agent 级别只能是 off/L1/L2" });
    }
    (patch as { agentLevel?: string }).agentLevel = b.agentLevel;
  }

  if (!Object.keys(patch).length) return reply.code(400).send({ error: "没有可保存的字段" });

  updateConfig((c) => {
    const next = { ...c };
    if (patch.ai) next.ai = { ...(next.ai ?? {}), ...patch.ai };
    if (patch.notifyWebhook !== undefined) {
      if (patch.notifyWebhook) next.notifyWebhook = patch.notifyWebhook;
      else delete next.notifyWebhook;
    }
    if (patch.digestTime) next.digestTime = patch.digestTime;
    if (patch.staleDays !== undefined) next.staleDays = patch.staleDays;
    if (patch.password !== undefined) {
      if (patch.password) next.password = patch.password;
      else delete next.password;
    }
    if (patch.agentLevel !== undefined) next.agentLevel = patch.agentLevel;
    return next;
  });

  if (patch.digestTime) timer = applyDigestTimer(patch.digestTime);
  return { ok: true, timer, timerSynced: timer?.ok ?? false, ...(timer?.error ? { timerMessage: timer.error } : {}) };
});

/** 测试推送:用当前(或表单未保存的)Webhook 发一条测试通知。 */
app.post("/api/notify/test", async (req, reply) => {
  const b = (req.body ?? {}) as { webhook?: unknown };
  const target = typeof b.webhook === "string" && b.webhook.trim() ? b.webhook.trim() : undefined;
  const res = await sendNotifyDetailed(
    "WorkNote 测试推送",
    ["## 🎉 测试推送成功", "", "企业微信通知已连通，每日晨报、待办到期、访客反馈将自动推送到本群。"],
    target,
    true,
  );
  if (!res.ok) {
    return reply.code(502).send({ error: `推送失败: ${res.error || "地址不可达或未配置(先保存或填入地址)"}` });
  }
  return { ok: true };
});

/* ---------------- 整理 Agent ---------------- */

app.get("/api/agent/runs", async () => {
  return { items: recentRuns(20) };
});

app.get("/api/agent/status", async () => {
  const cfg = readConfig();
  const systemdEnabled = process.env.WORKNOTE_SYSTEMD === "1";
  let running = false;
  if (systemdEnabled) {
    try {
      running = execFileSync("systemctl", ["is-active", "worknote-agent.service"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim() === "active";
    } catch {
      running = false;
    }
  }
  const runs = recentRuns(1);
  return { level: cfg.agentLevel ?? "off", running, systemdEnabled, last: runs[0] ?? null };
});

/** 立即运行一次(--no-block 启动 systemd oneshot,不等结束)。 */
app.post("/api/agent/run", async (_req, reply) => {
  if (process.env.WORKNOTE_SYSTEMD !== "1") {
    return reply.code(503).send({ error: "未启用 systemd 集成；请使用外部调度器或显式运行 Agent CLI（默认关闭）" });
  }
  const cfg = readConfig();
  if ((cfg.agentLevel ?? "off") === "off") {
    return reply.code(400).send({ error: "Agent 已在设置中关闭,请先开启" });
  }
  try {
    execFileSync("systemctl", ["start", "--no-block", "worknote-agent.service"]);
    return { ok: true };
  } catch (e) {
    return reply.code(500).send({ error: `启动失败:${e instanceof Error ? e.message : e}` });
  }
});

/** 拉取网关模型列表(可带未保存的 url/key 先行验证)。 */
app.post("/api/ai/models", async (req, reply) => {
  const b = (req.body ?? {}) as { url?: unknown; key?: unknown };
  const cfg: { url?: string; key?: string } = {};
  if (typeof b.url === "string" && b.url.trim()) cfg.url = b.url.trim();
  if (typeof b.key === "string" && b.key.trim()) cfg.key = b.key.trim();
  try {
    const models = await fetchAiModels(Object.keys(cfg).length ? cfg : undefined);
    return { ok: true, models };
  } catch (e) {
    return reply.code(502).send({ error: e instanceof Error ? e.message : "拉取模型列表失败" });
  }
});

/** 连通性测试:发一条最小请求,返回耗时与回复(可测未保存的配置)。 */
app.post("/api/ai/test", async (req, reply) => {
  const b = (req.body ?? {}) as { url?: unknown; key?: unknown; model?: unknown };
  const cfg: { url?: string; key?: string; model?: string } = {};
  if (typeof b.url === "string" && b.url.trim()) cfg.url = b.url.trim();
  if (typeof b.key === "string" && b.key.trim()) cfg.key = b.key.trim();
  if (typeof b.model === "string" && b.model.trim()) cfg.model = b.model.trim();
  try {
    const r = await testAi(Object.keys(cfg).length ? cfg : undefined);
    return { ok: true, ...r };
  } catch (e) {
    return reply.code(502).send({ error: e instanceof Error ? e.message : "测试失败" });
  }
});

/** 手动新建待办(支持传图)。 */
app.post("/api/todos", async (req, reply) => {
  const b = (req.body ?? {}) as {
    project?: unknown;
    name?: unknown;
    note?: unknown;
    priority?: unknown;
    progress?: unknown;
    start?: unknown;
    due?: unknown;
    type?: unknown;
    group?: unknown;
    system?: unknown;
    images?: unknown;
  };
  const projectName = typeof b.project === "string" ? b.project : "";
  const name = typeof b.name === "string" ? b.name : "";
  const nameError = todoNameError(name);
  if (nameError) return reply.code(400).send({ error: nameError });
  const proj = loadProjects().find((p) => p.slug === projectName || p.name === projectName);
  if (!proj) return reply.code(400).send({ error: "项目不存在，请在 projects.json 登记" });
  const type = typeof b.type === "string" ? b.type : "";
  if (type && !TYPE_ORDER.includes(type as (typeof TYPE_ORDER)[number])) {
    return reply.code(400).send({ error: "类型不合法" });
  }
  const priority = typeof b.priority === "string" ? b.priority : "";
  if (priority && !PRIORITY_ORDER.includes(priority as (typeof PRIORITY_ORDER)[number])) {
    return reply.code(400).send({ error: "优先级不合法" });
  }
  const progress = b.progress === undefined ? 0 : b.progress;
  if (!isTodoProgress(progress)) {
    return reply.code(400).send({ error: "待办进度需为0–100的整数" });
  }
  const existing = parseTodo(join(ROOT, "todo.md"));
  if ([...existing.open, ...existing.done].some((t) => t.name === name.trim())) {
    return reply.code(409).send({ error: "同名待办已存在,请更新原事项或使用不同名称" });
  }
  const start = typeof b.start === "string" ? b.start : "";
  if (start && !/^\d{4}-\d{2}-\d{2}$/.test(start)) {
    return reply.code(400).send({ error: "预计开始时间格式不合法(YYYY-MM-DD)" });
  }
  const due = typeof b.due === "string" ? b.due : "";
  if (due && !/^\d{4}-\d{2}-\d{2}$/.test(due)) {
    return reply.code(400).send({ error: "预计完成时间格式不合法(YYYY-MM-DD)" });
  }
  if (start && due && start > due) {
    return reply.code(400).send({ error: "预计开始不能晚于预计完成" });
  }

  let note = typeof b.note === "string" ? b.note : "";
  let refs: SavedImage[] = [];
  try {
    const res = attachImagesToNote(proj.slug, note, b.images);
    note = res.note;
    refs = res.refs;
  } catch (e) {
    return reply.code(400).send({ error: e instanceof Error ? e.message : "图片保存失败" });
  }

  const stamp = nowStamp();
  const r = createTodo(join(ROOT, "todo.md"), {
    projectName: proj.name,
    name: String(name).trim(),
    note,
    priority,
    progress,
    stamp,
    start,
    due,
    type,
    group: typeof b.group === "string" ? b.group : "",
    system: typeof b.system === "string" ? b.system : proj.systems[0] || "",
  });
  if (!r.ok) return reply.code(400).send({ error: r.error });
  const mutation = todoMutation(name.trim(), "");
  const dayWritten = mutation.done ? writeTodoCompletion(mutation.item, stamp) : false;
  return { ok: true, group: r.group, images: refs.map((x) => x.rel), dayWritten, ...mutation };
});

/** AI 解析(只返回草稿,不落盘)。 */
app.post("/api/todos/ai-parse", async (req, reply) => {
  if (!aiConfigured()) return reply.code(503).send({ error: "未配置 AI" });
  const b = (req.body ?? {}) as { text?: unknown; images?: unknown };
  const text = typeof b.text === "string" ? b.text : "";
  const images = Array.isArray(b.images) ? (b.images as string[]).slice(0, 6) : [];
  if (!text.trim() && !images.length) return reply.code(400).send({ error: "请提供文字或图片" });
  try {
    const draft = await analyzeTodoInput(text, images, { projects: projectOptions() });
    return { ok: true, draft };
  } catch (e) {
    return reply.code(502).send({ error: e instanceof Error ? e.message : "AI 解析失败" });
  }
});

/** 确认后新建(可来自手动或 AI 草稿;可携带图片作为附件)。 */
app.post("/api/todos/ai-create", async (req, reply) => {
  const b = (req.body ?? {}) as {
    project?: unknown;
    name?: unknown;
    note?: unknown;
    priority?: unknown;
    progress?: unknown;
    start?: unknown;
    due?: unknown;
    type?: unknown;
    group?: unknown;
    system?: unknown;
    images?: unknown;
  };
  const projectName = typeof b.project === "string" ? b.project : "";
  const name = typeof b.name === "string" ? b.name : "";
  const nameError = todoNameError(name);
  if (nameError) return reply.code(400).send({ error: nameError });
  const proj = loadProjects().find((p) => p.slug === projectName || p.name === projectName);
  if (!proj) return reply.code(400).send({ error: "项目不存在，请在 projects.json 登记" });

  const type = typeof b.type === "string" ? b.type : "";
  if (type && !TYPE_ORDER.includes(type as (typeof TYPE_ORDER)[number])) {
    return reply.code(400).send({ error: "类型不合法" });
  }
  const priority = typeof b.priority === "string" ? b.priority : "";
  if (priority && !PRIORITY_ORDER.includes(priority as (typeof PRIORITY_ORDER)[number])) {
    return reply.code(400).send({ error: "优先级不合法" });
  }
  const progress = b.progress === undefined ? 0 : b.progress;
  if (!isTodoProgress(progress)) {
    return reply.code(400).send({ error: "待办进度需为0–100的整数" });
  }
  const existing = parseTodo(join(ROOT, "todo.md"));
  if ([...existing.open, ...existing.done].some((t) => t.name === name.trim())) {
    return reply.code(409).send({ error: "同名待办已存在,请更新原事项或使用不同名称" });
  }
  const start = typeof b.start === "string" ? b.start : "";
  if (start && !/^\d{4}-\d{2}-\d{2}$/.test(start)) {
    return reply.code(400).send({ error: "预计开始时间格式不合法(YYYY-MM-DD)" });
  }
  const due = typeof b.due === "string" ? b.due : "";
  if (due && !/^\d{4}-\d{2}-\d{2}$/.test(due)) {
    return reply.code(400).send({ error: "预计完成时间格式不合法(YYYY-MM-DD)" });
  }
  if (start && due && start > due) {
    return reply.code(400).send({ error: "预计开始不能晚于预计完成" });
  }

  let note = typeof b.note === "string" ? b.note : "";
  let refs: SavedImage[] = [];
  try {
    const res = attachImagesToNote(proj.slug, note, b.images);
    note = res.note;
    refs = res.refs;
  } catch (e) {
    return reply.code(400).send({ error: e instanceof Error ? e.message : "图片保存失败" });
  }

  const stamp = nowStamp();
  const r = createTodo(join(ROOT, "todo.md"), {
    projectName: proj.name,
    name: String(name).trim(),
    note,
    priority,
    progress,
    stamp,
    start,
    due,
    type,
    group: typeof b.group === "string" ? b.group : "",
    system: typeof b.system === "string" ? b.system : proj.systems[0] || "",
  });
  if (!r.ok) return reply.code(400).send({ error: r.error });
  const mutation = todoMutation(name.trim(), "");
  const dayWritten = mutation.done ? writeTodoCompletion(mutation.item, stamp) : false;
  return { ok: true, group: r.group, images: refs.map((x) => x.rel), dayWritten, ...mutation };
});

/** 编辑待办(需登录)。 */
app.patch("/api/todos", async (req, reply) => {
  const b = (req.body ?? {}) as {
    name?: unknown;
    source?: unknown;
    patch?: {
      name?: unknown;
      note?: unknown;
      priority?: unknown;
      progress?: unknown;
      start?: unknown;
      due?: unknown;
      type?: unknown;
      project?: unknown;
      group?: unknown;
      images?: unknown;
    };
  };
  const name = typeof b.name === "string" ? b.name : "";
  const source = typeof b.source === "string" ? b.source : "";
  if (!name.trim()) return reply.code(400).send({ error: "缺少事项名称" });

  const p = b.patch ?? {};
  const before = todoSnapshot(name, typeof b.source === "string" ? b.source : undefined);
  if (!before) return reply.code(404).send({ error: "未找到唯一待办,重名事项请携带完整来源" });
  const progress = p.progress;
  if (progress !== undefined && !isTodoProgress(progress)) {
    return reply.code(400).send({ error: "待办进度需为0–100的整数" });
  }
  const nextName = typeof p.name === "string" && p.name.trim() ? p.name.trim() : before.item.name;
  if (typeof p.name === "string" && p.name !== before.item.name) {
    const nameError = todoNameError(p.name);
    if (nameError) return reply.code(400).send({ error: nameError });
  }
  if (nextName !== before.item.name) {
    const all = parseTodo(join(ROOT, "todo.md"));
    if ([...all.open, ...all.done].some((t) => t.name === nextName)) {
      return reply.code(409).send({ error: "同名待办已存在,请使用不同名称" });
    }
  }
  let note = typeof p.note === "string" ? p.note : undefined;
  const projectKey = typeof p.project === "string" ? p.project : undefined;
  const targetProject = projectKey ? loadProjects().find((x) => x.slug === projectKey || x.name === projectKey) : undefined;
  if (projectKey && !targetProject) {
    return reply.code(400).send({ error: "项目不存在，请在 projects.json 登记" });
  }
  const project = targetProject?.name;

  let refs: SavedImage[] = [];
  if (p.images && project) {
    const proj = loadProjects().find((x) => x.name === project);
    if (proj) {
      try {
        const res = attachImagesToNote(proj.slug, note ?? "", p.images);
        note = res.note;
        refs = res.refs;
      } catch (e) {
        return reply.code(400).send({ error: e instanceof Error ? e.message : "图片保存失败" });
      }
    }
  }

  const priority = typeof p.priority === "string" ? p.priority : undefined;
  if (priority && !PRIORITY_ORDER.includes(priority as (typeof PRIORITY_ORDER)[number])) {
    return reply.code(400).send({ error: "优先级不合法" });
  }
  const start = typeof p.start === "string" ? p.start : undefined;
  if (start && !/^\d{4}-\d{2}-\d{2}$/.test(start)) {
    return reply.code(400).send({ error: "预计开始时间格式不合法(YYYY-MM-DD)" });
  }
  const due = typeof p.due === "string" ? p.due : undefined;
  if (due && !/^\d{4}-\d{2}-\d{2}$/.test(due)) {
    return reply.code(400).send({ error: "预计完成时间格式不合法(YYYY-MM-DD)" });
  }
  const effectiveStart = start ?? before.item.start;
  const effectiveDue = due ?? before.item.due;
  if (effectiveStart && effectiveDue && effectiveStart > effectiveDue) {
    return reply.code(400).send({ error: "预计开始不能晚于预计完成" });
  }

  const patchData = {
    name: typeof p.name === "string" ? p.name : undefined,
    note,
    priority,
    progress,
    start,
    due,
    type: typeof p.type === "string" ? p.type : undefined,
    project,
    group: typeof p.group === "string" ? p.group : undefined,
  };

  const stamp = nowStamp();
  const r = updateTodo(join(ROOT, "todo.md"), before.item.name, before.item.source, patchData, stamp);
  if (r === "notfound") return reply.code(404).send({ error: "未找到该事项" });
  const mutation = todoMutation(nextName, before.item.source, { name: before.item.name, source: before.item.source });
  const dayWritten = !before.done && mutation.done ? writeTodoCompletion(mutation.item, stamp) : false;
  return { ok: true, images: refs.map((x) => x.rel), dayWritten, ...mutation };
});

/** 删除待办(需登录)。连同其下属的完成情况与反馈一并删除。 */
app.delete("/api/todos", async (req, reply) => {
  const b = (req.body ?? {}) as { name?: unknown; source?: unknown };
  const name = typeof b.name === "string" ? b.name : "";
  const source = typeof b.source === "string" ? b.source : "";
  if (!name.trim()) return reply.code(400).send({ error: "缺少事项名称" });

  const r = deleteTodo(join(ROOT, "todo.md"), name, source);
  if (r === "notfound") return reply.code(404).send({ error: "未找到该事项" });
  return { ok: true };
});

/** 管理员取消完成:`[x]` 翻回 `[ ]`,去掉完成标记;完成情况/反馈保留。 */
app.post("/api/todos/undone", async (req, reply) => {
  const b = (req.body ?? {}) as { name?: unknown; source?: unknown };
  const name = typeof b.name === "string" ? b.name : "";
  const source = typeof b.source === "string" ? b.source : "";
  if (!name) return reply.code(400).send({ error: "缺少事项名称" });

  const before = todoSnapshot(name, typeof b.source === "string" ? b.source : undefined);
  if (!before) return reply.code(404).send({ error: "未找到唯一待办,重名事项请携带完整来源" });

  const r = markTodoUndone(join(ROOT, "todo.md"), before.item.name, before.item.source);
  if (r === "notfound") return reply.code(404).send({ error: "未找到该事项" });
  return { ok: true, result: r, ...todoMutation(before.item.name, before.item.source) };
});

/** 管理员回复某条反馈(需登录)。fbIndex 为该待办下的第几条反馈(0 起)。 */
app.post("/api/todos/feedback-reply", async (req, reply) => {
  const b = (req.body ?? {}) as {
    name?: unknown;
    source?: unknown;
    fbIndex?: unknown;
    text?: unknown;
    images?: unknown;
  };
  const name = typeof b.name === "string" ? b.name : "";
  const source = typeof b.source === "string" ? b.source : "";
  const fbIndex = Number(b.fbIndex);
  const text = typeof b.text === "string" ? b.text : "";
  if (!name || !Number.isInteger(fbIndex) || fbIndex < 0) {
    return reply.code(400).send({ error: "参数不完整" });
  }
  if (!text.trim()) return reply.code(400).send({ error: "回复内容不能为空" });

  // 定位所属项目(校验该待办存在)
  const proj = loadProjects().find((p) =>
    todoForGroup(groupPrefix(p.name)).open.concat(todoForGroup(groupPrefix(p.name)).done)
      .some((i) => i.name === name && (!source || i.source === source)),
  );
  if (!proj) return reply.code(404).send({ error: "未找到该事项" });

  const imagesIn = Array.isArray(b.images) ? (b.images as { dataUrl: string; alt?: string }[]) : [];
  let refs: SavedImage[] = [];
  if (imagesIn.length) {
    try {
      refs = saveImages(ROOT, proj.slug, today(), nowHHMM(), imagesIn.slice(0, 6));
    } catch (e) {
      return reply.code(400).send({ error: e instanceof Error ? e.message : "图片保存失败" });
    }
  }

  const at = `${today()} ${nowHHMM().replace(/(\d{2})(\d{2})/, "$1:$2")}`;
  const r = setFeedbackReply(join(ROOT, "todo.md"), name, source, fbIndex, {
    by: "管理员",
    at,
    text: text.trim(),
    images: refs.map((x) => ({ alt: "回复截图", src: x.rel })),
  });
  if (r === "notfound") return reply.code(404).send({ error: "未找到该事项" });
  if (r === "outofrange") return reply.code(404).send({ error: "反馈序号越界" });
  return { ok: true, images: refs.map((x) => x.rel) };
});

/** 勾选完成 + 写入完成情况(文字与图片)。analyze=true 时先让 AI 整理文字。 */
app.post("/api/todos/complete", async (req, reply) => {
  const b = (req.body ?? {}) as {
    name?: unknown;
    source?: unknown;
    text?: unknown;
    images?: unknown;
    project?: unknown;
    analyze?: unknown;
  };
  const name = typeof b.name === "string" ? b.name : "";
  const source = typeof b.source === "string" ? b.source : "";
  if (!name) return reply.code(400).send({ error: "缺少事项名称" });

  const before = todoSnapshot(name, typeof b.source === "string" ? b.source : undefined);
  if (!before) return reply.code(404).send({ error: "未找到唯一待办,重名事项请携带完整来源" });
  const proj = projectForTodo(before.item);
  if (!proj) return reply.code(404).send({ error: "未找到该事项所属项目" });
  if (typeof b.project === "string" && b.project && b.project !== proj.name && b.project !== proj.slug) {
    return reply.code(400).send({ error: "指定项目与待办归属不一致" });
  }

  let text = typeof b.text === "string" ? b.text : "";
  const imagesIn = Array.isArray(b.images) ? (b.images as { dataUrl: string; alt?: string }[]) : [];

  // AI 整理(可选)
  if (b.analyze === true && aiConfigured()) {
    const r = await analyzeCompletion(text, imagesIn.map((i) => i.dataUrl), {
      name,
      projectName: proj.name,
    });
    text = r.text;
  }

  // 图片落盘
  let refs: SavedImage[] = [];
  if (imagesIn.length) {
    try {
      refs = saveImages(ROOT, proj.slug, today(), nowHHMM(), imagesIn.slice(0, 6));
    } catch (e) {
      return reply.code(400).send({ error: e instanceof Error ? e.message : "图片保存失败" });
    }
  }

  const stamp = nowStamp();
  const result = markTodoDone(join(ROOT, "todo.md"), before.item.name, before.item.source, stamp, {
    text,
    images: refs.map((r) => ({ alt: "完成截图", src: r.rel })),
  });
  if (result === "notfound") return reply.code(404).send({ error: "未找到该事项" });

  // 真正进入完成态才记一次;重复保存100%/补写完成情况不重复追加。
  const mutation = todoMutation(before.item.name, before.item.source);
  const dayWritten = result === "done" ? writeTodoCompletion(mutation.item, stamp, text, refs) : false;
  return { ok: true, result, images: refs.map((x) => x.rel), dayWritten, ...mutation };
});

/* ---------------- 全部记录浏览 ---------------- */

app.get("/api/records", async (req, reply) => {
  const { offset, limit } = req.query as { offset?: string; limit?: string };
  const off = Math.max(0, Number(offset ?? 0) || 0);
  const lim = Math.min(1000, Math.max(1, Number(limit ?? 1000) || 1000));
  const { items, total, dayCount } = listDaySummaries(ROOT, off, lim);
  return { offset: off, limit: lim, total, dayCount, items };
});

/* ---------------- 全站搜索(记录条目 + 待办清单) ---------------- */

app.get("/api/search", async (req) => {
  const { q } = req.query as { q?: string };
  const query = (q ?? "").toString();
  if (!query.trim()) return { q: query, total: 0, items: [], todos: [] };
  const items = searchEntries(ROOT, query);
  const todos = searchTodos(ROOT, query);
  return { q: query, total: items.length + todos.length, items, todos };
});

/* ---------------- AI 问答(基于检索资料) ---------------- */

/** AI 问答的停用词(切词后过滤,避免拿「什么/哪些」这类词去检索)。 */
const ASK_STOPWORDS = new Set([
  "的", "了", "吗", "呢", "吧", "哪些", "什么", "怎么", "怎样", "如何", "还是",
  "有没有", "是不是", "请问", "一下", "最近", "这个", "那个", "我们", "自己",
  "情况", "问题", "告诉", "帮忙", "查查", "看看",
]);

/** 从自然语言问题里提取检索关键词(中文连续段与英文单词,≥2 字符)。 */
function askTerms(q: string): string[] {
  const raw = q
    .split(/[^\w\u4e00-\u9fff]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !ASK_STOPWORDS.has(t));
  const terms = [...new Set(raw)].slice(0, 5);
  return terms.length ? terms : [q.trim()];
}

/** 把问题拆成 CJK 二元组 + 英文单词(中文无分词,整句包含匹配不可行,用二元组重叠打分)。 */
function questionGrams(q: string): Set<string> {
  const grams = new Set<string>();
  for (const seg of q.toLowerCase().split(/[^\w\u4e00-\u9fff]+/)) {
    if (!seg) continue;
    if (/^[\u4e00-\u9fff]+$/.test(seg)) {
      for (let i = 0; i + 1 < seg.length; i++) grams.add(seg.slice(i, i + 2));
    } else if (seg.length >= 2) {
      grams.add(seg);
    }
  }
  return grams;
}

/** 计算文本命中的二元组个数(宽松匹配打分)。 */
function gramHits(hay: string, grams: Set<string>): number {
  const h = hay.toLowerCase();
  let n = 0;
  for (const g of grams) {
    if (h.includes(g)) n += 1;
  }
  return n;
}

app.post("/api/ai/ask", async (req, reply) => {
  if (!aiConfigured()) return reply.code(503).send({ error: "未配置 AI" });
  const b = (req.body ?? {}) as { q?: unknown };
  const question = typeof b.q === "string" ? b.q.trim() : "";
  if (!question) return reply.code(400).send({ error: "问题不能为空" });
  if (question.length > 200) return reply.code(400).send({ error: "问题过长(≤200 字)" });

  // 二元组打分检索:记录条目与待办按命中信号数排序,取头部
  const grams = questionGrams(question);
  const minHits = Math.max(2, Math.ceil(grams.size * 0.25));

  const projects = loadProjects();
  const recordHits = projects
    .flatMap((p) =>
      p.days.flatMap((d) =>
        d.entries.map((e) => {
          const hay = `${e.title}\n${e.module}\n${e.blocks.map((bl) => bl.text).join("\n")}`;
          return {
            hits: gramHits(hay, grams),
            slug: p.slug,
            projectName: p.name,
            date: d.date,
            entry: e,
          };
        }),
      ),
    )
    .filter((x) => x.hits >= minHits)
    .sort((a, b2) => b2.hits - a.hits || (a.date < b2.date ? 1 : -1))
    .slice(0, 12);

  const todoAll = parseTodo(join(ROOT, "todo.md"));
  const openSet = new Set(todoAll.open);
  const todoHits = [...todoAll.open, ...todoAll.done]
    .map((t) => ({
      t,
      hits: gramHits(
        `${t.name}\n${t.note}\n${t.group}\n${t.completion.text}\n${t.feedback.map((f) => `${f.by} ${f.text}`).join("\n")}`,
        grams,
      ),
      status: (openSet.has(t) ? "open" : "done") as "open" | "done",
    }))
    .filter((x) => x.hits >= minHits)
    .sort((a, b2) => b2.hits - a.hits)
    .slice(0, 8);

  // 组装上下文(全库统计 + 命中条目摘要,封顶防超长)
  const ctx: string[] = [
    `全库统计:项目 ${projects.length} 个,记录条目 ${projects.reduce((s, p) => s + p.entryCount, 0)} 条,未完成待办 ${todoAll.open.length} 条,已完成 ${todoAll.done.length} 条。`,
    `检索关键词(近似):${askTerms(question).join("、")}`,
  ];
  if (recordHits.length) ctx.push("【相关记录】");
  for (const h of recordHits) {
    const body = h.entry.blocks.map((bl) => bl.text).join(" ").replace(/\s+/g, " ").trim();
    ctx.push(`[${h.date} ${h.projectName}] ${h.entry.title}(${h.entry.module || "-"}|${h.entry.type || "-"}):${body.slice(0, 160)}`);
  }
  if (todoHits.length) ctx.push("【相关待办】");
  for (const t of todoHits) {
    const brief = (t.t.note || t.t.completion.text || "").replace(/\s+/g, " ").slice(0, 120);
    ctx.push(`[待办·${t.status === "open" ? "未完成" : "已完成"}] ${t.t.name}(${t.t.group}) —— ${brief}`);
  }
  if (!recordHits.length && !todoHits.length) ctx.push("(检索未命中任何记录或待办)");
  const context = ctx.join("\n").slice(0, 8000);

  try {
    const answer = await askRecords(question, context);
    return {
      ok: true,
      answer,
      terms: askTerms(question),
      refs: [
        ...recordHits.map((h) => ({
          kind: "record" as const,
          label: `${h.date} ${h.entry.title}`,
          to: `/days/${h.slug}/${h.date}#${h.entry.anchor}`,
        })),
        ...todoHits.map((t) => ({
          kind: "todo" as const,
          label: `${t.status === "open" ? "未完成" : "已完成"} ${t.t.name}`,
          to: "/todo",
        })),
      ],
    };
  } catch (e) {
    return reply.code(502).send({ error: e instanceof Error ? e.message : "AI 问答失败" });
  }
});

/* ---------------- 收件箱(快速捕获,先存后整理) ---------------- */

/** 收件箱图片直读 inbox/attachments/,路径限定在收件箱目录内。 */
app.get("/api/inbox/attachment/:file", async (req, reply) => {
  const { file } = req.params as { file: string };
  if (!ATTACHMENT_FILE.test(file) || file.includes("..")) return reply.code(400).send({ error: "非法路径" });
  let path: string;
  try {
    const root = realpathSync(ROOT);
    const inbox = realpathSync(join(root, "inbox"));
    const attachments = realpathSync(join(inbox, "attachments"));
    path = realpathSync(join(attachments, file));
    if (!within(root, inbox) || !within(inbox, attachments) || !within(attachments, path) || !statSync(path).isFile()) {
      return reply.code(403).send({ error: "无权访问该附件" });
    }
  } catch {
    return reply.code(404).send({ error: "附件不存在" });
  }

  const query = (req.query ?? {}) as { thumb?: string; w?: string };
  const isThumb = query.thumb === "1" || query.thumb === "true" || !!query.w;
  if (isThumb) {
    const width = Math.min(1200, Math.max(80, Number(query.w) || DEFAULT_THUMB_WIDTH));
    const res = await getOrGenerateThumbnail(ROOT, path, width);
    reply.header("Content-Type", res.mime);
    reply.header("Cache-Control", "private, max-age=2592000, immutable");
    return reply.send(createReadStream(res.path));
  }
  const ext = file.split(".").pop()?.toLowerCase() ?? "";
  const mime: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
  };
  reply.header("Content-Type", mime[ext] ?? "application/octet-stream");
  reply.header("Cache-Control", "private, max-age=86400");
  return reply.send(createReadStream(path));
});

app.get("/api/inbox", async () => {
  const items = listInbox(ROOT).map((it) => ({
    id: it.id,
    at: it.at,
    text: it.text,
    images: it.images.map((im) => ({
      alt: im.alt,
      url: `/api/inbox/attachment/${im.src.replace(/^attachments\//, "")}`,
    })),
  }));
  return { items, count: items.length };
});

/** 快速记一笔:文字 + 截图(Ctrl+V 粘贴),落进 inbox.md。 */
app.post("/api/inbox", async (req, reply) => {
  const b = (req.body ?? {}) as { text?: unknown; images?: unknown };
  const text = typeof b.text === "string" ? b.text.trim() : "";
  const imagesIn = Array.isArray(b.images) ? (b.images as { dataUrl: string; alt?: string }[]) : [];
  if (!text && !imagesIn.length) return reply.code(400).send({ error: "内容不能为空" });

  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const at = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;

  let saved: ReturnType<typeof saveInboxImages> = [];
  if (imagesIn.length) {
    try {
      saved = saveInboxImages(ROOT, at.slice(11).replace(":", ""), imagesIn.slice(0, 6));
    } catch (e) {
      return reply.code(400).send({ error: e instanceof Error ? e.message : "图片保存失败" });
    }
  }
  const id = appendInboxItem(ROOT, at, text || "(仅截图)", saved.map((s) => ({ rel: s.rel })));
  return { ok: true, id, count: listInbox(ROOT).length };
});

/** 整理完成:删除对应小节(附件一并清理)。 */
app.delete("/api/inbox", async (req, reply) => {
  const b = (req.body ?? {}) as { id?: unknown };
  const id = typeof b.id === "string" ? b.id.trim() : "";
  if (!id) return reply.code(400).send({ error: "缺少条目 id" });
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(-\d+)?$/.test(id)) {
    return reply.code(400).send({ error: "id 格式不合法" });
  }
  const ok = deleteInboxItem(ROOT, id);
  if (!ok) return reply.code(404).send({ error: "条目不存在" });
  return { ok: true, count: listInbox(ROOT).length };
});

/* ---------------- 汇报生成 ---------------- */

app.get("/api/report", async (req, reply) => {
  const { from, to } = (req.query ?? {}) as { from?: string; to?: string };
  if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return reply.code(400).send({ error: "需要 from/to(YYYY-MM-DD)" });
  }
  if (from > to) return reply.code(400).send({ error: "from 不能晚于 to" });
  const { markdown, stats } = buildReport(ROOT, from, to);
  return { from, to, markdown, html: renderMarkdown(markdown), stats };
});

/* ---------------- 项目模块清单(验收进度) ---------------- */

/** 模块清单(纯手动登记的独立实体,与记录条目的「模块」字段无关)。 */
app.get("/api/modules/:slug", async (req, reply) => {
  const { slug } = req.params as { slug: string };
  const p = loadProjects().find((x) => x.slug === slug);
  if (!p) return reply.code(404).send({ error: "项目不存在" });
  return { modules: listModules(ROOT, slug) };
});

/** 新增/更新模块(upsert;oldName 传入且与 name 不同时为原位重命名)。
 *  body 含 sub 时操作的是 name 模块下的子模块(oldSub 为子模块重命名)。 */
app.post("/api/modules/:slug", async (req, reply) => {
  const { slug } = req.params as { slug: string };
  const p = loadProjects().find((x) => x.slug === slug);
  if (!p) return reply.code(404).send({ error: "项目不存在" });
  const b = (req.body ?? {}) as { name?: unknown; oldName?: unknown; sub?: unknown; oldSub?: unknown; status?: unknown; progress?: unknown; note?: unknown };
  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (!name) return reply.code(400).send({ error: "模块名不能为空" });
  const oldName = typeof b.oldName === "string" && b.oldName.trim() ? b.oldName.trim() : undefined;
  const sub = typeof b.sub === "string" && b.sub.trim() ? b.sub.trim() : undefined;
  const oldSub = typeof b.oldSub === "string" && b.oldSub.trim() ? b.oldSub.trim() : undefined;
  const status = typeof b.status === "string" ? b.status : undefined;
  if (status && !(MODULE_STATUSES as readonly string[]).includes(status)) {
    return reply.code(400).send({ error: `状态需为 ${MODULE_STATUSES.join("|")}` });
  }
  const progressRaw = b.progress;
  let progress = 0;
  if (progressRaw !== undefined && progressRaw !== null && progressRaw !== "") {
    progress = typeof progressRaw === "number" ? progressRaw : Number(progressRaw);
    if (Number.isNaN(progress) || progress < 0 || progress > 100) {
      return reply.code(400).send({ error: "进度需为 0-100" });
    }
  }
  const note = typeof b.note === "string" ? b.note : "";
  const d = new Date();
  const p2 = (n: number) => String(n).padStart(2, "0");
  const updated = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
  const r = sub
    ? upsertSub(ROOT, slug, name, { name: sub, oldName: oldSub, status: status as ModuleStatus | undefined, progress, note, updated })
    : upsertModule(ROOT, slug, { name, oldName, status: status as ModuleStatus | undefined, progress, note, updated });
  if (!r.ok) return reply.code(400).send({ error: r.error });
  return { ok: true, modules: listModules(ROOT, slug) };
});

/** 删除模块登记(仅删登记,不影响记录与待办)。 */
app.delete("/api/modules/:slug", async (req, reply) => {
  const { slug } = req.params as { slug: string };
  const p = loadProjects().find((x) => x.slug === slug);
  if (!p) return reply.code(404).send({ error: "项目不存在" });
  const b = (req.body ?? {}) as { name?: unknown; sub?: unknown };
  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (!name) return reply.code(400).send({ error: "缺少模块名" });
  const sub = typeof b.sub === "string" && b.sub.trim() ? b.sub.trim() : undefined;
  const ok = deleteModule(ROOT, slug, name, sub);
  if (!ok) return reply.code(404).send({ error: sub ? "子模块不存在" : "模块不存在" });
  return { ok: true, modules: listModules(ROOT, slug) };
});

/* ---------------- 项目详情 / 单日 ---------------- */

/** 登录后的项目选项与统计,包括已登记但没有日记录的项目。 */
app.get("/api/projects", async () => ({
  projects: loadProjects().map(({ slug, name, systems, dayCount, entryCount, counts, dateRange }) => ({
    slug, name, systems, dayCount, entryCount, counts, dateRange,
  })),
}));

app.get("/api/projects/:slug", async (req, reply) => {
  const { slug } = req.params as { slug: string };
  const p = loadProjects().find((x) => x.slug === slug);
  if (!p) return reply.code(404).send({ error: "项目不存在" });
  return hydrate(p);
});

app.get("/api/days/:slug/:date", async (req, reply) => {
  const { slug, date } = req.params as { slug: string; date: string };
  const p = loadProjects().find((x) => x.slug === slug);
  const d = p?.days.find((x) => x.date === date);
  if (!p || !d) return reply.code(404).send({ error: "记录不存在" });

  // p.days 为日期倒序,故 prev(更早)= i+1,next(更晚)= i-1
  const i = p.days.findIndex((x) => x.date === date);
  const prev = i + 1 < p.days.length ? p.days[i + 1].date : null;
  const next = i - 1 >= 0 ? p.days[i - 1].date : null;

  return {
    typeOrder: TYPE_ORDER,
    ...hydrate(p).days.find((x) => x.date === date)!,
    projectName: p.name,
    projectSlug: p.slug,
    prev,
    next,
  };
});

/* ---------------- 分享(登录后管理;凭 token 免登录访问) ---------------- */

/** 分享内容:该项目待办 + 项目基本信息 + 权限(支持 _all 全库分享)。 */
function sharePayload(token: string) {
  const share = findByToken(ROOT, token);
  if (!share) return null;

  const pick = (i: TodoItem) => ({
    name: i.name,
    note: i.note,
    priority: i.priority,
    progress: i.progress,
    start: i.start,
    due: i.due,
    type: i.type,
    group: i.group,
    source: i.source,
    sourceText: i.sourceText,
    created: i.created,
    completion: i.completion,
    feedback: i.feedback,
  });

  if (share.project === "_all") {
    const { open, done } = parseTodo(join(ROOT, "todo.md"));
    const allProjects = loadProjects();
    return {
      token,
      mode: share.mode,
      label: share.label || "全库待办看板",
      feedbackBy: share.feedbackBy,
      project: {
        slug: "_all",
        name: "全库待办看板",
        systems: [...new Set(allProjects.flatMap((p) => p.systems))],
      },
      todo: { open: open.map(pick), done: done.map(pick) },
      modules: [],
    };
  }

  const p = loadProjects().find((x) => x.slug === share.project);
  if (!p) return null;
  const group = groupPrefix(p.name);
  const { open, done } = todoForGroup(group);
  return {
    token,
    mode: share.mode,
    label: share.label,
    feedbackBy: share.feedbackBy,
    project: { slug: p.slug, name: p.name, systems: p.systems },
    todo: { open: open.map(pick), done: done.map(pick) },
    // 模块与验收清单随分享页只读展示(文件即真相,分享时现读)
    modules: listModules(ROOT, p.slug),
  };
}

app.get("/api/share/:token", async (req, reply) => {
  const { token } = req.params as { token: string };
  const payload = sharePayload(token);
  if (!payload) return reply.code(404).send({ error: "分享链接无效或已撤销" });
  return payload;
});

/** Images visible to a share must be referenced by tasks in that share, not merely exist in a project. */
function todoImageSources(item: TodoItem): string[] {
  const sources = [...item.note.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)].map((match) => match[1].trim());
  sources.push(...item.completion.images.map((image) => image.src));
  for (const feedback of item.feedback) {
    sources.push(...feedback.images.map((image) => image.src));
    const reply = (feedback as { reply?: { images: { src: string }[] } }).reply;
    if (reply) sources.push(...reply.images.map((image) => image.src));
  }
  return sources;
}

app.get("/api/share/:token/attachment/*", async (req, reply) => {
  const { token } = req.params as { token: string };
  const filePart = (req.params as Record<string, string>)["*"] ?? "";
  const share = findByToken(ROOT, token);
  if (!share) return reply.code(404).send({ error: "分享链接无效或已撤销" });

  const match = filePart.match(/^projects\/([^/]+)\/daily\/(\d{4}-\d{2})\/(\d{4}-\d{2}-\d{2})\/attachments\/([^/]+)$/);
  if (!match || match[2] !== match[3].slice(0, 7) || (share.project !== "_all" && share.project !== match[1])) {
    return reply.code(403).send({ error: "无权访问该附件" });
  }
  const projects = loadProjects();
  if (!projects.some((project) => project.slug === match[1])) return reply.code(403).send({ error: "无权访问该附件" });
  const todos = parseTodo(join(ROOT, "todo.md"));
  const allowed = [...todos.open, ...todos.done].some((item) => {
    const owner = projectForTodo(item);
    return owner && (share.project === "_all" || owner.slug === share.project) && todoImageSources(item).includes(filePart);
  });
  if (!allowed) return reply.code(403).send({ error: "该图片未被分享待办引用" });
  const path = attachmentFile(match[1], match[3], match[4]);
  if (!path) return reply.code(404).send({ error: "附件不存在或路径不合法" });

  const query = (req.query ?? {}) as { thumb?: string; w?: string };
  const isThumb = query.thumb === "1" || query.thumb === "true" || !!query.w;
  reply.header("Cache-Control", "private, no-store");
  if (isThumb) {
    const width = Math.min(1200, Math.max(80, Number(query.w) || DEFAULT_THUMB_WIDTH));
    const res = await getOrGenerateThumbnail(ROOT, path, width);
    reply.header("Content-Type", res.mime);
    return reply.send(createReadStream(res.path));
  }
  const ext = match[4].split(".").pop()?.toLowerCase() ?? "";
  const mime: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", avif: "image/avif" };
  reply.header("Content-Type", mime[ext] ?? "application/octet-stream");
  return reply.send(createReadStream(path));
});

/** 分享链接(mode=edit)勾选待办 -> 写回 todo.md。 */
app.post("/api/share/:token/todo", async (req, reply) => {
  const { token } = req.params as { token: string };
  // CSRF:要求自定义头,跨站脚本无法在无 CORS 的情况下伪造
  if (req.headers["x-requested-with"] !== "worknote") {
    return reply.code(403).send({ error: "非法请求" });
  }
  const share = findByToken(ROOT, token);
  if (!share) return reply.code(404).send({ error: "分享链接无效或已撤销" });
  if (share.mode !== "edit") return reply.code(403).send({ error: "该链接仅可查看" });

  const body = (req.body ?? {}) as { name?: unknown; source?: unknown; progress?: unknown };
  if (body.progress !== undefined) return reply.code(403).send({ error: "分享页进度只读,仅可勾选完成" });
  const name = typeof body.name === "string" ? body.name : "";
  const source = typeof body.source === "string" ? body.source : "";
  if (!name) return reply.code(400).send({ error: "缺少事项名称" });

  const before = todoSnapshot(name, typeof body.source === "string" ? body.source : undefined);
  if (!before || before.done) return reply.code(403).send({ error: "该事项已完成或无法唯一定位" });
  if (share.project !== "_all" && projectForTodo(before.item)?.slug !== share.project) {
    return reply.code(403).send({ error: "该事项不属于此项目" });
  }
  const result = markTodoDone(join(ROOT, "todo.md"), before.item.name, before.item.source, nowStamp());
  if (result === "notfound") return reply.code(404).send({ error: "未找到该事项" });
  return { ok: true, result, ...todoMutation(before.item.name, before.item.source) };
});

/**
 * 分享链接(mode=edit)按待办提交反馈 -> 追加到 todo.md 该条目的反馈子块。
 * 反馈方在生成链接时写死(share.feedbackBy),访客不可改。
 */
app.post("/api/share/:token/feedback", async (req, reply) => {
  const { token } = req.params as { token: string };
  if (req.headers["x-requested-with"] !== "worknote") {
    return reply.code(403).send({ error: "非法请求" });
  }
  const share = findByToken(ROOT, token);
  if (!share) return reply.code(404).send({ error: "分享链接无效或已撤销" });
  if (share.mode !== "edit") return reply.code(403).send({ error: "该链接仅可查看" });

  const body = (req.body ?? {}) as { name?: unknown; source?: unknown; text?: unknown; images?: unknown };
  const name = typeof body.name === "string" ? body.name : "";
  const source = typeof body.source === "string" ? body.source : "";
  const text = typeof body.text === "string" ? body.text : "";
  const imagesIn = Array.isArray(body.images) ? (body.images as { dataUrl: string; alt?: string }[]) : [];
  if (!name) return reply.code(400).send({ error: "缺少事项名称" });
  if (!text.trim() && !imagesIn.length) return reply.code(400).send({ error: "反馈内容不能为空" });

  const target = todoSnapshot(name, typeof body.source === "string" ? body.source : undefined);
  const targetProject = target && projectForTodo(target.item);
  if (!target || !targetProject || (share.project !== "_all" && targetProject.slug !== share.project)) {
    return reply.code(403).send({ error: "该事项不属于此项目或无法唯一定位" });
  }
  const targetSlug = targetProject.slug;

  // 图片落盘(与完成情况同一套约定)
  let refs: SavedImage[] = [];
  if (imagesIn.length) {
    try {
      refs = saveImages(ROOT, targetSlug, today(), nowHHMM(), imagesIn.slice(0, 6));
    } catch (e) {
      return reply.code(400).send({ error: e instanceof Error ? e.message : "图片保存失败" });
    }
  }

  const at = `${today()} ${nowHHMM().replace(/(\d{2})(\d{2})/, "$1:$2")}`;
  const r = appendFeedback(join(ROOT, "todo.md"), target.item.name, target.item.source, {
    by: share.feedbackBy || share.label || "访客",
    at,
    text: text.trim(),
    images: refs.map((x) => ({ alt: "反馈截图", src: x.rel })),
  });
  if (r === "notfound") return reply.code(404).send({ error: "未找到该事项" });

  // 即时通知(配置了 WORKNOTE_NOTIFY_WEBHOOK 时):反馈不再静默等待发现
  void sendNotify(
    "WorkNote 收到新反馈",
    [
      `## 💬 收到新反馈`,
      "",
      `**[${share.feedbackBy || share.label || "访客"}]** 对「${name}」提交了反馈`,
      "",
      `<font color="comment">${at}</font>`,
      "",
      `> ${text.trim().slice(0, 120) || "(仅图片)"}`,
    ],
    undefined,
    true,
  );
  return { ok: true, images: refs.map((x) => x.rel) };
});

/* ---- 分享管理(需登录;preHandler 已拦截) ---- */

app.get("/api/shares", async () => ({ items: listShares(ROOT) }));

app.post("/api/shares", async (req, reply) => {
  const body = (req.body ?? {}) as {
    project?: unknown;
    mode?: unknown;
    label?: unknown;
    feedbackBy?: unknown;
  };
  const project = typeof body.project === "string" ? body.project : "";
  const mode: ShareMode = body.mode === "edit" ? "edit" : "view";
  const label = typeof body.label === "string" ? body.label : "";
  const feedbackBy = typeof body.feedbackBy === "string" ? body.feedbackBy.trim() : "";
  if (project !== "_all" && !loadProjects().some((p) => p.slug === project)) {
    return reply.code(400).send({ error: "项目不存在" });
  }
  if (mode === "edit" && !feedbackBy) {
    return reply.code(400).send({ error: "可反馈的分享链接需填写反馈方" });
  }
  const share = createShare(ROOT, project, mode, label, feedbackBy);
  if (!share) return reply.code(400).send({ error: "无法创建分享" });
  return share;
});

/** 修改既有分享的权限(模式/反馈方);token 不变,链接保持有效。 */
app.patch("/api/shares/:token", async (req, reply) => {
  const { token } = req.params as { token: string };
  const body = (req.body ?? {}) as { mode?: unknown; feedbackBy?: unknown };
  const patch: { mode?: ShareMode; feedbackBy?: string } = {};
  if (body.mode === "view" || body.mode === "edit") patch.mode = body.mode;
  if (typeof body.feedbackBy === "string") patch.feedbackBy = body.feedbackBy;
  if (!patch.mode && patch.feedbackBy === undefined) {
    return reply.code(400).send({ error: "没有可修改的字段" });
  }
  if (patch.mode === "edit" && !patch.feedbackBy) {
    // 升级为 edit 时必须给反馈方(或沿用已有)
    const existing = findByToken(ROOT, token);
    const keep = existing?.feedbackBy ?? "";
    if (!keep) return reply.code(400).send({ error: "升为可反馈需提供反馈方" });
  }
  const share = updateShare(ROOT, token, patch);
  if (!share) return reply.code(404).send({ error: "分享不存在" });
  return share;
});

app.delete("/api/shares/:token", async (req, reply) => {
  const { token } = req.params as { token: string };
  const ok = revokeShare(ROOT, token);
  if (!ok) return reply.code(404).send({ error: "分享不存在" });
  return { ok: true };
});

const clientRoot = join(sourceRoot, "public", "app");
if (process.env.WORKNOTE_SERVE_CLIENT !== "false" && existsSync(join(clientRoot, "index.html"))) {
  await app.register(fastifyStatic, { root: clientRoot, wildcard: false, dotfiles: "deny" });
  app.setNotFoundHandler((req, reply) => {
    const path = req.url.split("?")[0];
    if (!["GET", "HEAD"].includes(req.method) || /^\/(?:api|attachments)(?:\/|$)/.test(path)) {
      return reply.code(404).send({ error: "路径不存在" });
    }
    return reply.type("text/html").sendFile("index.html");
  });
}

try {
  // Fail early on invalid project metadata, rather than serving an apparently empty data set.
  loadProjects();
  await app.listen({ port: PORT, host: HOST });
  app.log.info(`WorkNote API 已启动 http://${HOST}:${PORT} (root=${ROOT})`);
  if (!authConfigured()) app.log.warn("未配置 WORKNOTE_PASSWORD / WORKNOTE_SECRET,登录功能不可用");
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}