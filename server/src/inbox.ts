/**
 * 收件箱:先存后整理的快速捕获区。
 *
 * 数据落 ROOT/inbox.md:每个条目一个小节 `## YYYY-MM-DD HH:MM`(重名追加 -N 后缀),
 * 正文为自由文本,图片以 `![说明](attachments/<文件>)` 内嵌;
 * 图片文件存 ROOT/inbox/attachments/HHMM-序号.<ext>(与项目附件同一套命名与权限约定)。
 * 整理时由助手(或用户)把内容归档为正式记录(record add 支持直接引用这里的绝对路径),
 * 归档后删除对应小节(附件文件一并清理)。
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { atomicWrite } from "./todo-write.js";
import { decodeDataUrl, MAX_IMAGE_BYTES } from "./attachments-write.js";

export interface InboxImage {
  alt: string;
  /** 相对 inbox.md 的引用(inbox/attachments 下的文件名)。 */
  src: string;
}

export interface InboxItem {
  /** 小节标题全文(含可能的 -N 后缀),删除时按它定位。 */
  id: string;
  /** 创建时刻 YYYY-MM-DD HH:MM。 */
  at: string;
  text: string;
  images: InboxImage[];
}

export interface SavedInboxImage {
  /** 仓库根相对路径(inbox/attachments/<file>)。 */
  rel: string;
  file: string;
}

const EXT_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

const HEAD_RE = /^##\s+(\d{4}-\d{2}-\d{2} \d{2}:\d{2})(?:-\d+)?\s*$/;

export function inboxFile(root: string): string {
  return join(root, "inbox.md");
}

function attachmentsDir(root: string): string {
  return join(root, "inbox", "attachments");
}

/** 保存图片到 inbox/attachments/,命名 HHMM-序号.<ext>,目录 755、文件 644。 */
export function saveInboxImages(
  root: string,
  hhmm: string,
  images: { dataUrl: string; alt?: string }[],
): SavedInboxImage[] {
  const dir = attachmentsDir(root);
  mkdirSync(dir, { recursive: true, mode: 0o755 });
  const existing = existsSync(dir) ? readdirSync(dir) : [];
  let seq = 0;
  for (const f of existing) {
    const m = f.match(new RegExp(`^${hhmm}-(\\d+)\\.`));
    if (m) seq = Math.max(seq, Number(m[1]));
  }
  const out: SavedInboxImage[] = [];
  for (const im of images) {
    const dec = decodeDataUrl(im.dataUrl);
    if (!dec) continue;
    const ext = EXT_BY_MIME[dec.mime];
    if (!ext) continue;
    if (dec.buf.length > MAX_IMAGE_BYTES) {
      throw new Error(`图片超过 ${MAX_IMAGE_BYTES / 1024 / 1024}MB 上限`);
    }
    seq += 1;
    const file = `${hhmm}-${String(seq).padStart(2, "0")}.${ext}`;
    const abs = join(dir, file);
    writeFileSync(abs, dec.buf);
    chmodSync(abs, 0o644);
    out.push({ rel: `inbox/attachments/${file}`, file });
  }
  return out;
}

/** 解析 inbox.md -> 条目列表(新建在前)。文件不存在返回空。 */
export function listInbox(root: string): InboxItem[] {
  const file = inboxFile(root);
  if (!existsSync(file)) return [];
  const lines = readFileSync(file, "utf-8").replace(/\r\n/g, "\n").split("\n");
  const items: InboxItem[] = [];
  let cur: InboxItem | null = null;
  for (const raw of lines) {
    const t = raw.trim();
    if (HEAD_RE.test(t)) {
      if (cur) items.push(cur);
      const id = t.replace(/^##\s+/, "").trim();
      cur = { id, at: id.replace(/-\d+$/, ""), text: "", images: [] };
      continue;
    }
    if (!cur) continue;
    const im = t.match(/^!\[([^\]]*)\]\(([^)]+)\)\s*$/);
    if (im) {
      cur.images.push({ alt: im[1].trim(), src: im[2].trim() });
      continue;
    }
    if (!t || t === "---" || t.startsWith("#")) continue;
    cur.text += (cur.text ? "\n" : "") + t;
  }
  if (cur) items.push(cur);
  return items.reverse();
}

/** 追加一条收件箱条目(图片需已落盘,引用写成 attachments/<file>)。 */
export function appendInboxItem(
  root: string,
  at: string,
  text: string,
  images: { rel: string; alt?: string }[],
): string {
  const file = inboxFile(root);
  const existing = listInbox(root);
  // id 去重:同分钟多条时追加 -2、-3
  let id = at;
  let n = 2;
  while (existing.some((i) => i.id === id)) {
    id = `${at}-${n++}`;
  }
  const section: string[] = [`## ${id}`, "", text.trim()];
  if (images.length) {
    section.push("");
    for (const im of images) {
      section.push(`![${im.alt || "截图"}](${im.rel.replace(/^inbox\/attachments\//, "attachments/")})`);
    }
  }
  section.push("", "---", "");
  if (!existsSync(file)) {
    atomicWrite(file, `# 收件箱\n\n> 快速捕获区:随手记下待整理的文字与截图,由助手归档为正式记录后删除对应小节。\n\n${section.join("\n")}`);
    return id;
  }
  const raw = readFileSync(file, "utf-8").replace(/\r\n/g, "\n").replace(/\s+$/, "\n");
  atomicWrite(file, `${raw}${section.join("\n")}`);
  return id;
}

/** 删除一条收件箱条目(连同其附件文件,尽力清理)。 */
export function deleteInboxItem(root: string, id: string): boolean {
  const file = inboxFile(root);
  if (!existsSync(file)) return false;
  const lines = readFileSync(file, "utf-8").replace(/\r\n/g, "\n").split("\n");
  const head = `## ${id}`;
  const start = lines.findIndex((l) => l.trim() === head);
  if (start < 0) return false;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (HEAD_RE.test(lines[i].trim())) {
      end = i;
      break;
    }
  }
  const section = lines.slice(start, end).join("\n");
  // 清理该节引用的附件(只允许 inbox/attachments 下的文件名)
  for (const m of section.matchAll(/!\[[^\]]*\]\(attachments\/([^)]+)\)/g)) {
    const name = m[1].trim();
    if (name.includes("/") || name.includes("..")) continue;
    try {
      rmSync(join(attachmentsDir(root), name), { force: true });
    } catch {
      /* 删除失败不影响条目移除 */
    }
  }
  // 去掉小节及其结尾分隔线
  let next = lines.slice(0, start).concat(lines.slice(end));
  while (next.length && (next[next.length - 1].trim() === "" || next[next.length - 1].trim() === "---")) {
    next.pop();
  }
  next.push("");
  atomicWrite(file, next.join("\n"));
  return true;
}
