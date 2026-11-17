/**
 * 通知基础:环境配置读取 + Webhook 文本推送。
 *
 * 用途:① 每日晨报(digest CLI,systemd timer 触发);
 *      ② 分享页访客提交反馈后的即时提醒。
 * 设计原则:推送失败绝不影响主流程——所有异常吞掉并返回 false,只打日志。
 * Webhook 地址来自环境变量 WORKNOTE_NOTIFY_WEBHOOK 或 site-config.json 的 notifyWebhook
 * (支持企业微信群机器人、飞书/Lark 群机器人、钉钉群机器人或通用 {"title","text"} 接口)。
 * 未配置时推送函数直接返回 false。
 */

import { readConfig } from "./site-config.js";
import { loadEnvironment } from "./environment.js";

/** API 与 CLI 共用显式环境文件;不会隐式读取系统级配置。 */
export function loadWorknoteEnv(): void {
  loadEnvironment();
}

/** 通知 Webhook 地址(站点设置 > env;未配置返回 null)。读取时机在调用时,改完即时生效。 */
export function notifyWebhook(): string | null {
  const fromCfg = (readConfig().notifyWebhook ?? "").trim();
  if (fromCfg) return fromCfg;
  const url = (process.env.WORKNOTE_NOTIFY_WEBHOOK ?? "").trim();
  return url ? url : null;
}

export function notifyConfigured(): boolean {
  return notifyWebhook() !== null;
}

/**
 * 推送文本通知(详细结果版,返回失败原因)。
 * 自动识别平台报文格式:
 *  - 飞书 / Lark: {"msg_type":"text","content":{"text":"..."}}
 *  - 企业微信: {"msgtype":"text","text":{"content":"..."}}
 *  - 钉钉: {"msgtype":"text","text":{"content":"..."}}
 *  - 通用 Webhook: {"title":"...","text":"..."}
 */
export async function sendNotifyDetailed(
  title: string,
  lines: string[],
  url?: string,
  markdown = false,
): Promise<{ ok: boolean; error?: string }> {
  const target = (url ?? notifyWebhook() ?? "").trim();
  if (!target) return { ok: false, error: "未配置通知 Webhook 地址" };

  const text = [title, ...lines].join("\n");
  let body: unknown;
  if (/feishu\.cn|larksuite\.com|larkcloud/i.test(target)) {
    body = { msg_type: "text", content: { text } };
  } else if (/qyapi\.weixin\.qq\.com|work\.weixin\.qq\.com/i.test(target)) {
    // 企业微信群机器人: 支持 markdown 类型(加粗/链接/彩色文字)
    body = markdown
      ? { msgtype: "markdown", markdown: { content: text } }
      : { msgtype: "text", text: { content: text } };
  } else if (/dingtalk\.com/i.test(target)) {
    // 钉钉群机器人: 支持 markdown 类型
    body = markdown
      ? { msgtype: "markdown", markdown: { title, text } }
      : { msgtype: "text", text: { content: text } };
  } else {
    // 通用接口: title + text
    body = { title, text };
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  try {
    console.log("[notify] Sending configured notification");
    const res = await fetch(target, {
      method: "POST",
      signal: ctrl.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const rawBody = await res.text();
    console.log(`[notify] response ${res.status}: ${rawBody.slice(0, 300)}`);
    if (!res.ok) {
      const msg = `HTTP ${res.status}${rawBody ? ` ${rawBody.slice(0, 150)}` : ""}`;
      console.error(`通知推送失败: ${msg}`);
      return { ok: false, error: msg };
    }

    // 检查响应 JSON (企业微信/钉钉返回 errcode, 飞书返回 code/StatusCode)
    const resJson = (() => {
      try { return JSON.parse(rawBody); } catch { return null; }
    })() as {
      errcode?: number;
      errmsg?: string;
      code?: number;
      msg?: string;
      StatusCode?: number;
    } | null;

    if (resJson && typeof resJson === "object") {
      if (resJson.errcode !== undefined && resJson.errcode !== 0) {
        const msg = `平台返回错误 (${resJson.errcode}): ${resJson.errmsg || "未知错误"}`;
        console.error(`通知推送失败: ${msg}`);
        return { ok: false, error: msg };
      }
      if (resJson.code !== undefined && resJson.code !== 0) {
        const msg = `平台返回错误 (${resJson.code}): ${resJson.msg || "未知错误"}`;
        console.error(`通知推送失败: ${msg}`);
        return { ok: false, error: msg };
      }
    }

    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`通知推送失败: ${msg}`);
    return { ok: false, error: msg };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 推送文本通知(简写兼容版)。10 秒超时,任何失败只打日志不抛出。
 */
export async function sendNotify(title: string, lines: string[], url?: string, markdown = false): Promise<boolean> {
  const r = await sendNotifyDetailed(title, lines, url, markdown);
  return r.ok;
}
