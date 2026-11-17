/**
 * 站点统一配置:所有可配置项的运行时覆盖层。
 *
 * 单一文件 ROOT/site-config.json(权限 600,已 gitignore,含密钥勿入库):
 *   { ai: { url, key, model }, notifyWebhook, digestTime, staleDays, password }
 * 优先级:site-config.json > 环境变量或显式加载的 .env。
 * 读取发生在每次使用时——改完即时生效,无需重启(登录口令亦然);
 * 删掉文件或「清空覆盖」即整体回落到环境变量部署态。
 */

import { chmodSync, existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { dataRoot } from "./environment.js";

export interface AiConfigOverride {
  url?: string;
  key?: string;
  model?: string;
}

export interface SiteConfig {
  ai?: AiConfigOverride;
  /** 通知 Webhook(飞书群机器人或通用 {"title","text"} 接口);删除该键回落 env。 */
  notifyWebhook?: string;
  /** 晨报时间 HH:MM(缺省 08:30;保存时由 API 同步 systemd timer)。 */
  digestTime?: string;
  /** 待办滞留提醒阈值天数(缺省 14)。 */
  staleDays?: number;
  /** 登录口令覆盖(与 WORKNOTE_SECRET 无关,改口令不影响既有会话)。 */
  password?: string;
  /** 整理 Agent 级别:off 关闭 | L1 仅预览建议 | L2 自主执行绿色操作(黄色转人工)。 */
  agentLevel?: "off" | "L1" | "L2";
}

/** 服务与 CLI 共用隔离的数据目录。 */
const root = dataRoot;

const FILE = "site-config.json";
const LEGACY = "ai-config.json";

function readJson(file: string): Record<string, unknown> | null {
  try {
    if (!existsSync(file)) return null;
    return JSON.parse(readFileSync(file, "utf-8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** 读当前配置(含旧版 ai-config.json 兼容合并;文件损坏按空处理,env 兜底仍在)。 */
export function readConfig(): SiteConfig {
  const out: SiteConfig = {};
  const legacy = readJson(resolve(root(), LEGACY));
  if (legacy) out.ai = legacy as AiConfigOverride;
  const main = readJson(resolve(root(), FILE));
  if (main) {
    if (main.ai && typeof main.ai === "object") {
      out.ai = { ...(out.ai ?? {}), ...(main.ai as AiConfigOverride) };
    }
    for (const k of ["notifyWebhook", "digestTime", "staleDays", "password", "agentLevel"] as const) {
      if (main[k] !== undefined) {
        (out as Record<string, unknown>)[k] = main[k];
      }
    }
  }
  return out;
}

/** 读-改-写更新(同步互斥由 Node 单线程保证),写回 600。 */
export function updateConfig(fn: (c: SiteConfig) => SiteConfig): SiteConfig {
  const next = fn(readConfig());
  const f = resolve(root(), FILE);
  mkdirSync(dirname(f), { recursive: true, mode: 0o755 });
  const temp = `${f}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(next, null, 2) + "\n", { mode: 0o600 });
  renameSync(temp, f);
  try {
    chmodSync(f, 0o600);
  } catch {
    /* chmod 失败不影响功能 */
  }
  return next;
}

/** 站点覆盖里的生效值(供各模块取用):覆盖 > env > 默认。 */
export function effValue<T>(cfgValue: T | undefined, envValue: T | undefined, fallback: T): T {
  if (cfgValue !== undefined && cfgValue !== ("" as unknown as T)) return cfgValue;
  if (envValue !== undefined && envValue !== ("" as unknown as T)) return envValue;
  return fallback;
}
