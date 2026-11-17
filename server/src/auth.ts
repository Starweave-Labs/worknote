/**
 * 鉴权层:单口令登录 + 自签名会话 cookie。
 *
 * 不引入第三方依赖,只用 node:crypto 做 HMAC-SHA256 签名。
 * cookie 形态:`wn_session=v1.<exp>.<sig>`,服务端无状态,重启不掉线。
 * 会话密钥来自环境变量 WORKNOTE_SECRET(仅 env,站点不可改——改了会踢掉所有会话);
 * 登录口令支持运行时覆盖:site-config.json 的 password(站点「设置」页)
 * > 环境变量 WORKNOTE_PASSWORD,改口令即时生效且不影响既有会话。
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { readConfig } from "./site-config.js";

const COOKIE_NAME = "wn_session";
const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 天

/** 会话密钥;缺失时视为未配置,登录功能整体关闭(而非降级为无校验)。 */
const SECRET = process.env.WORKNOTE_SECRET ?? "";

/** 生效登录口令(站点覆盖 > env)。每次校验现读,改完即时生效。 */
function effectivePassword(): string {
  const fromCfg = readConfig().password ?? "";
  if (fromCfg) return fromCfg;
  return process.env.WORKNOTE_PASSWORD ?? "";
}

export function authConfigured(): boolean {
  return SECRET.length >= 16 && effectivePassword().length > 0;
}

/** 定长比较,避免按字符提前返回泄露长度/前缀。 */
function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf-8");
  const bb = Buffer.from(b, "utf-8");
  if (ba.length !== bb.length) {
    // 长度不等时也要做一次比较,保持大致恒定的时间开销
    timingSafeEqual(ba, ba);
    return false;
  }
  return timingSafeEqual(ba, bb);
}

function sign(payload: string): string {
  return createHmac("sha256", SECRET).update(payload).digest("base64url");
}

/** 校验口令。 */
export function checkPassword(input: unknown): boolean {
  if (!authConfigured()) return false;
  if (typeof input !== "string" || !input) return false;
  return safeEqual(input, effectivePassword());
}

/** 签发会话 cookie 值。 */
export function issueSession(): string {
  const exp = Date.now() + TTL_MS;
  const payload = `v1.${exp}`;
  return `${payload}.${sign(payload)}`;
}

/** 校验会话 cookie 值(签名 + 未过期)。 */
export function verifySession(raw: string | undefined): boolean {
  if (!raw || !authConfigured()) return false;
  const parts = raw.split(".");
  if (parts.length !== 3) return false;
  const [ver, expStr, sig] = parts;
  if (ver !== "v1") return false;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < Date.now()) return false;
  return safeEqual(sig, sign(`${ver}.${expStr}`));
}

/** 从 Cookie 头里取出会话值。 */
export function readSessionCookie(cookieHeader: string | undefined): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === COOKIE_NAME) return part.slice(eq + 1).trim();
  }
  return undefined;
}

/** 生成 Set-Cookie 头。 */
export function sessionCookie(value: string, maxAgeSec: number): string {
  const attrs = [
    `${COOKIE_NAME}=${value}`,
    "Path=/",
    "HttpOnly",
    ...(process.env.WORKNOTE_SECURE_COOKIE === "false" ? [] : ["Secure"]),
    "SameSite=Lax",
    `Max-Age=${maxAgeSec}`,
  ];
  return attrs.join("; ");
}

export function clearCookie(): string {
  return sessionCookie("", 0);
}

/* ---- 登录失败限流:内存计数,按 IP。单进程足够,重启即清零。 ---- */

const MAX_ATTEMPTS = 10;
const WINDOW_MS = 15 * 60 * 1000;
const attempts = new Map<string, { count: number; first: number }>();

export function tooManyAttempts(ip: string): boolean {
  const rec = attempts.get(ip);
  if (!rec) return false;
  if (Date.now() - rec.first > WINDOW_MS) {
    attempts.delete(ip);
    return false;
  }
  return rec.count >= MAX_ATTEMPTS;
}

export function recordFailure(ip: string): void {
  const now = Date.now();
  const rec = attempts.get(ip);
  if (!rec || now - rec.first > WINDOW_MS) {
    attempts.set(ip, { count: 1, first: now });
    return;
  }
  rec.count += 1;
}

export function clearFailures(ip: string): void {
  attempts.delete(ip);
}