/**
 * 分享链接:按项目生成只读 token,可撤销,生成时可选「仅查看 / 可编辑」。
 *
 * 存储为私有数据根目录的 shares.json(原子写,权限 600)。
 */

import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, renameSync, chmodSync } from "node:fs";
import { join } from "node:path";

export type ShareMode = "view" | "edit";

export interface Share {
  token: string;
  project: string;
  mode: ShareMode;
  label: string;
  /** 反馈方(生成链接时写死):访客提交反馈时记为此身份。 */
  feedbackBy: string;
  createdAt: string;
}

interface SharesFile {
  shares: Share[];
}

/** 项目 slug 是否合法(与 parser 的目录名规则一致, _all 代表全库)。 */
const SLUG_RE = /^(?:[a-z0-9][a-z0-9_-]*|_all)$/;

function fileOf(root: string): string {
  return join(root, "shares.json");
}

function read(root: string): SharesFile {
  const p = fileOf(root);
  if (!existsSync(p)) return { shares: [] };
  try {
    const raw = JSON.parse(readFileSync(p, "utf-8")) as SharesFile;
    if (!raw || !Array.isArray(raw.shares)) return { shares: [] };
    // 老数据可能缺字段,补齐默认值保持向后兼容
    raw.shares = raw.shares.map((s) => ({ ...s, feedbackBy: s.feedbackBy ?? "" }));
    return raw;
  } catch {
    return { shares: [] };
  }
}

/** 原子写:先写临时文件再 rename,避免读到半截 JSON。 */
function write(root: string, data: SharesFile): void {
  const p = fileOf(root);
  const tmp = `${p}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n", "utf-8");
  chmodSync(tmp, 0o600);
  renameSync(tmp, p);
}

export function listShares(root: string): Share[] {
  return read(root).shares.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export function findByToken(root: string, token: string): Share | undefined {
  return read(root).shares.find((s) => s.token === token);
}

export function createShare(
  root: string,
  project: string,
  mode: ShareMode,
  label: string,
  feedbackBy: string,
): Share | null {
  if (!SLUG_RE.test(project)) return null;
  const share: Share = {
    token: randomBytes(24).toString("base64url"),
    project,
    mode: mode === "edit" ? "edit" : "view",
    label: (label || "").slice(0, 60),
    feedbackBy: (feedbackBy || "").trim().slice(0, 40),
    createdAt: new Date().toISOString(),
  };
  const data = read(root);
  data.shares.push(share);
  write(root, data);
  return share;
}

export function revokeShare(root: string, token: string): boolean {
  const data = read(root);
  const before = data.shares.length;
  data.shares = data.shares.filter((s) => s.token !== token);
  if (data.shares.length === before) return false;
  write(root, data);
  return true;
}

/** 可修改的字段;undefined 表示不改动。 */
export interface SharePatch {
  mode?: ShareMode;
  feedbackBy?: string;
}

/** 修改既有分享的权限(token 与创建时间不变,链接保持有效)。 */
export function updateShare(
  root: string,
  token: string,
  patch: SharePatch,
): Share | null {
  const data = read(root);
  const s = data.shares.find((x) => x.token === token);
  if (!s) return null;
  if (patch.mode !== undefined) s.mode = patch.mode === "edit" ? "edit" : "view";
  if (patch.feedbackBy !== undefined) s.feedbackBy = patch.feedbackBy.trim().slice(0, 40);
  write(root, data);
  return s;
}
