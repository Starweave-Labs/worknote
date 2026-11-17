/**
 * 项目模块清单:模块作为项目级实体,可标记验收进度;支持两级层级。
 *
 * 存储:`projects/<slug>/modules.md`(与 todo.md 同哲学,文件即真相,原子写)。
 * 层级:父模块 `## 名称`,子模块 `### 名称` 嵌套其下——状态/备注父子独立;
 * **进度**:有子模块的父模块不手设,自动取子模块进度均值(读时派生 + 写时同步);无子模块时手动。
 * 状态四档:未开始 | 进行中 | 待验收 | 已验收(验收进度语义)。
 * 登记来源:站点手动创建/维护(纯手动的独立实体,与记录条目「模块」字段无关)、
 * 整理 Agent 根据记录内容更新(upsert)。
 */

import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { atomicWrite } from "./todo-write.js";
import { COLON } from "./todo-format.js";

export const MODULE_STATUSES = ["未开始", "进行中", "待验收", "已验收"] as const;
export type ModuleStatus = (typeof MODULE_STATUSES)[number];

/** 子模块(与父模块同构,少一层嵌套)。 */
export interface ModuleSub {
  name: string;
  status: ModuleStatus;
  progress: number;
  note: string;
  updated: string;
}

export interface ModuleItem {
  name: string;
  status: ModuleStatus;
  /** 验收进度 0-100(可省略,缺省 0)。 */
  progress: number;
  note: string;
  /** 最近更新 YYYY-MM-DD。 */
  updated: string;
  /** 子模块列表(保持插入顺序)。 */
  subs: ModuleSub[];
}

export function modulesFile(root: string, slug: string): string {
  return join(root, "projects", slug, "modules.md");
}

/** 字段行:`- **状态**：X` 或手写 `- 状态：X`(兼容不加粗)。 */
const FIELD_RE = /^-\s*(?:\*\*)?([^*]+?)(?:\*\*)?[：:]\s*(.*)$/;

const HEADER_NOTE = (statuses: readonly string[]) =>
  `> 模块用 ## ,子模块用 ### 嵌套其下;父子各有独立状态与进度。状态:${statuses.join(" | ")};进度 0-100。由站点/助手维护。`;

function emptyLevel(name: string): ModuleSub {
  return { name, status: "未开始", progress: 0, note: "", updated: "" };
}

/** 父模块自动进度 = 子模块进度均值(四舍五入);无子模块返回 null(手动)。 */
function meanProgress(subs: ModuleSub[]): number | null {
  if (!subs.length) return null;
  return Math.round(subs.reduce((s, x) => s + x.progress, 0) / subs.length);
}

/**
 * 进度→状态联动规则(拖动进度等未显式给状态时自动推导):
 * 0 未开始 | 1-79 进行中 | 80-99 待验收 | 100 已验收。
 */
function statusForProgress(pct: number): ModuleStatus {
  if (pct >= 100) return "已验收";
  if (pct >= 80) return "待验收";
  if (pct > 0) return "进行中";
  return "未开始";
}

/** 解析 modules.md;文件不存在返回空。半角冒号兼容(手写容错)。 */
export function listModules(root: string, slug: string): ModuleItem[] {
  const file = modulesFile(root, slug);
  if (!existsSync(file)) return [];
  const lines = readFileSync(file, "utf-8").replace(/\r\n/g, "\n").split("\n");
  const out: ModuleItem[] = [];
  let cur: ModuleItem | null = null;
  let curSub: ModuleSub | null = null;
  for (const raw of lines) {
    const t = raw.trim();
    if (t.startsWith("## ")) {
      if (cur) out.push(cur);
      cur = { ...emptyLevel(t.slice(3).trim()), subs: [] };
      curSub = null;
      continue;
    }
    if (!cur) continue;
    if (t.startsWith("### ")) {
      if (curSub) cur.subs.push(curSub);
      curSub = emptyLevel(t.slice(4).trim());
      continue;
    }
    const m = t.match(FIELD_RE);
    if (!m) continue;
    const field = m[1].trim();
    const val = m[2].trim();
    const target: ModuleSub = curSub ?? cur;
    if (field === "状态" && (MODULE_STATUSES as readonly string[]).includes(val)) {
      target.status = val as ModuleStatus;
    } else if (field === "进度") {
      const n = Number(val);
      if (Number.isFinite(n)) target.progress = Math.max(0, Math.min(100, Math.round(n)));
    } else if (field === "备注") {
      target.note = val;
    } else if (field === "更新") {
      target.updated = val;
    }
  }
  if (curSub && cur) cur.subs.push(curSub);
  if (cur && cur.name) out.push(cur);
  // 父模块进度派生:有子模块即取均值(文件手改也不会破坏一致性)
  for (const m of out) {
    const auto = meanProgress(m.subs);
    if (auto !== null) m.progress = auto;
  }
  return out;
}

function buildLevelLines(m: ModuleSub, heading: string): string[] {
  return [
    heading,
    "",
    `- **状态**${COLON}${m.status}`,
    `- **进度**${COLON}${m.progress}`,
    ...(m.note ? [`- **备注**${COLON}${m.note}`] : []),
    `- **更新**${COLON}${m.updated}`,
    "",
  ];
}

function serialize(modules: ModuleItem[]): string {
  return [
    "# 模块清单",
    "",
    `> ${HEADER_NOTE(MODULE_STATUSES)}`,
    "",
    ...modules.flatMap((m) => [
      ...buildLevelLines(m, `## ${m.name}`),
      ...m.subs.flatMap((s) => buildLevelLines(s, `### ${s.name}`)),
    ]),
  ].join("\n");
}

/** 新增或更新父模块(upsert;oldName 时原位重命名,保留其子模块)。原子写。 */
export function upsertModule(
  root: string,
  slug: string,
  item: { name: string; oldName?: string; status?: string; progress?: number; note?: string; updated: string },
): { ok: true } | { ok: false; error: string } {
  const name = item.name.trim();
  if (!name) return { ok: false, error: "模块名不能为空" };
  if (name.length > 40) return { ok: false, error: "模块名过长(≤40 字)" };
  const statusGiven = item.status !== undefined && item.status !== "";
  const status = item.status as ModuleStatus | undefined;
  if (statusGiven && !MODULE_STATUSES.includes(status!)) {
    return { ok: false, error: `状态需为 ${MODULE_STATUSES.join("|")}` };
  }
  const progress = Math.max(0, Math.min(100, Math.round(item.progress ?? 0)));
  const note = (item.note ?? "").trim().replace(/\s*\n\s*/g, " ");
  const oldName = item.oldName?.trim();

  const file = modulesFile(root, slug);
  const existing = listModules(root, slug);
  const fresh = (subs: ModuleSub[]): ModuleItem => {
    const auto = meanProgress(subs);
    const finalProgress = auto ?? progress;
    return {
      name,
      // 状态未显式给 → 按进度联动推导;显式给(编辑器手选)→ 尊重
      status: statusGiven ? status! : statusForProgress(finalProgress),
      progress: finalProgress,
      note,
      updated: item.updated,
      subs,
    };
  };

  let next: ModuleItem[];
  if (oldName && oldName !== name) {
    if (existing.some((m) => m.name === name)) return { ok: false, error: `同名模块已存在:${name}` };
    const idx = existing.findIndex((m) => m.name === oldName);
    if (idx < 0) return { ok: false, error: `原模块不存在:${oldName}` };
    next = existing.slice();
    next[idx] = fresh(existing[idx]!.subs); // 重命名保留子模块
  } else if (existing.some((m) => m.name === name)) {
    next = existing.map((m) => (m.name === name ? fresh(m.subs) : m)); // 更新保留子模块
  } else {
    next = [...existing, fresh([])];
  }

  atomicWrite(file, serialize(next));
  return { ok: true };
}

/** 新增或更新子模块(upsert;oldName 时原位重命名)。父模块不存在则报错。 */
export function upsertSub(
  root: string,
  slug: string,
  parentName: string,
  item: { name: string; oldName?: string; status?: string; progress?: number; note?: string; updated: string },
): { ok: true } | { ok: false; error: string } {
  const name = item.name.trim();
  if (!name) return { ok: false, error: "子模块名不能为空" };
  if (name.length > 40) return { ok: false, error: "子模块名过长(≤40 字)" };
  const statusGiven = item.status !== undefined && item.status !== "";
  const status = item.status as ModuleStatus | undefined;
  if (statusGiven && !MODULE_STATUSES.includes(status!)) {
    return { ok: false, error: `状态需为 ${MODULE_STATUSES.join("|")}` };
  }
  const progress = Math.max(0, Math.min(100, Math.round(item.progress ?? 0)));
  const note = (item.note ?? "").trim().replace(/\s*\n\s*/g, " ");
  const oldName = item.oldName?.trim();

  const file = modulesFile(root, slug);
  const existing = listModules(root, slug);
  const parentIdx = existing.findIndex((m) => m.name === parentName);
  if (parentIdx < 0) return { ok: false, error: `父模块不存在:${parentName}` };
  const parent = existing[parentIdx]!;
  const subs = parent.subs;
  const fresh: ModuleSub = {
    name,
    status: statusGiven ? status! : statusForProgress(progress),
    progress,
    note,
    updated: item.updated,
  };

  let nextSubs: ModuleSub[];
  if (oldName && oldName !== name) {
    if (subs.some((s) => s.name === name)) return { ok: false, error: `同名子模块已存在:${name}` };
    const idx = subs.findIndex((s) => s.name === oldName);
    if (idx < 0) return { ok: false, error: `原子模块不存在:${oldName}` };
    nextSubs = subs.slice();
    nextSubs[idx] = fresh;
  } else if (subs.some((s) => s.name === name)) {
    nextSubs = subs.map((s) => (s.name === name ? fresh : s));
  } else {
    nextSubs = [...subs, fresh];
  }

  const next = existing.slice();
  const auto = meanProgress(nextSubs);
  next[parentIdx] = {
    ...parent,
    subs: nextSubs,
    // 有子模块的父模块:进度与状态均由子模块派生(联动)
    progress: auto ?? parent.progress,
    status: auto !== null ? statusForProgress(auto) : parent.status,
  };
  atomicWrite(file, serialize(next));
  return { ok: true };
}

/** 删除父模块(连同其全部子模块)或指定子模块;返回是否删除。 */
export function deleteModule(root: string, slug: string, name: string, subName?: string): boolean {
  const file = modulesFile(root, slug);
  if (!existsSync(file)) return false;
  const existing = listModules(root, slug);
  const idx = existing.findIndex((m) => m.name === name);
  if (idx < 0) return false;

  if (subName) {
    const parent = existing[idx]!;
    if (!parent.subs.some((s) => s.name === subName)) return false;
    const subs = parent.subs.filter((s) => s.name !== subName);
    const auto = meanProgress(subs);
    const next = existing.slice();
    next[idx] = {
      ...parent,
      subs,
      progress: auto ?? parent.progress,
      status: auto !== null ? statusForProgress(auto) : parent.status,
    };
    atomicWrite(file, serialize(next));
    return true;
  }

  const next = existing.filter((m) => m.name !== name);
  // 清空时保留文件头(仍可再添加),避免"文件消失"的困惑
  atomicWrite(
    file,
    next.length
      ? serialize(next)
      : `# 模块清单\n\n> ${HEADER_NOTE(MODULE_STATUSES)}\n`,
  );
  return true;
}

/** 相对仓库根的路径(日志/接口回显用)。 */
export function modulesRelPath(root: string, slug: string): string {
  return relative(root, modulesFile(root, slug));
}
