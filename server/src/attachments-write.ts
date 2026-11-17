/**
 * 附件落盘:把前端上传的 base64 图片写入当日 attachments/。
 *
 * 沿用 AGENTS.md 约定:命名 HHMM-序号.<ext>,目录 755、文件 644,保留原图不压缩。
 * 返回相对于仓库根的路径,便于写入 todo.md 的图片引用。
 */

import { existsSync, mkdirSync, writeFileSync, chmodSync, readdirSync } from "node:fs";
import { join } from "node:path";

const EXT_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

/** 单图上限 8MB(解码后),总上限由调用方控制。 */
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export interface SavedImage {
  /** 仓库根相对路径(用于 todo.md 引用)。 */
  rel: string;
  /** 文件名。 */
  file: string;
}

/** 从 data URL 解析出 mime 与二进制。 */
export function decodeDataUrl(dataUrl: string): { mime: string; buf: Buffer } | null {
  const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!m) return null;
  const buf = Buffer.from(m[2], "base64");
  return { mime: m[1].toLowerCase(), buf };
}

/**
 * 保存一组图片到 projects/<slug>/daily/<YYYY-MM>/<YYYY-MM-DD>/attachments/。
 * @param hhmm 用于文件名的时刻(HHMM);由调用方给,避免服务端时区歧义。
 */
export function saveImages(
  root: string,
  slug: string,
  date: string,
  hhmm: string,
  images: { dataUrl: string; alt?: string }[],
): SavedImage[] {
  if (!images.length) return [];
  const month = date.slice(0, 7);
  const dir = join(root, "projects", slug, "daily", month, date, "attachments");
  mkdirSync(dir, { recursive: true, mode: 0o755 });

  // 序号:从现有 HHMM-*.png 起递增
  const existing = existsSync(dir) ? readdirSync(dir) : [];
  let seq = 0;
  for (const f of existing) {
    const m = f.match(new RegExp(`^${hhmm}-(\\d+)\\.`));
    if (m) seq = Math.max(seq, Number(m[1]));
  }

  const out: SavedImage[] = [];
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
    out.push({
      rel: `projects/${slug}/daily/${month}/${date}/attachments/${file}`,
      file,
    });
  }
  return out;
}