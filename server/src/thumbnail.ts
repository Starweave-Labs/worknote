/**
 * 缩略图生成与文件级持久化缓存模块。
 *
 * 将高分辨率原图（通常 2MB~4MB）等比缩放至最大宽度（默认 480px），
 * 转换为轻量高品质 WebP（通常 10KB~25KB），显著降低网络传输与浏览器解码压力。
 * 缩略图生成后持久化在 ROOT/.cache/thumbs/，结合强缓存头实现毫秒级响应。
 */

import { existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import sharp from "sharp";

export interface ThumbnailResult {
  path: string;
  mime: string;
}

/** 默认缩略图最大宽度(px),高按原图比例自适应 */
export const DEFAULT_THUMB_WIDTH = 480;

/**
 * 获取或生成图片的缩略图。
 * @param root 项目根目录
 * @param originalPath 原图绝对路径
 * @param maxWidth 缩略图最大宽度，超出则等比缩小，未达到不拉伸
 */
export async function getOrGenerateThumbnail(
  root: string,
  originalPath: string,
  maxWidth: number = DEFAULT_THUMB_WIDTH,
): Promise<ThumbnailResult> {
  // SVG 或不存在的文件直接降级原样返回
  if (originalPath.toLowerCase().endsWith(".svg")) {
    return { path: originalPath, mime: "image/svg+xml" };
  }
  if (!existsSync(originalPath)) {
    return { path: originalPath, mime: "application/octet-stream" };
  }

  // 计算缓存路径: 保留在 ROOT/.cache/thumbs/ 下的镜像子目录
  // 例如 projects/example/daily/2026-01/2026-01-15/attachments/0900-01.png
  // -> .cache/thumbs/projects/example/daily/2026-01/2026-01-15/attachments/0900-01.w480.webp
  const rel = relative(root, originalPath);
  const cachePath = join(
    root,
    ".cache",
    "thumbs",
    `${rel}.w${maxWidth}.webp`,
  );

  try {
    const origStat = statSync(originalPath);
    if (existsSync(cachePath)) {
      const cacheStat = statSync(cachePath);
      // 缓存文件有效且修改时间不早于原图，直接命中
      if (cacheStat.size > 0 && cacheStat.mtimeMs >= origStat.mtimeMs) {
        return { path: cachePath, mime: "image/webp" };
      }
    }

    // 确保缓存目录存在
    const cacheDir = dirname(cachePath);
    if (!existsSync(cacheDir)) {
      mkdirSync(cacheDir, { recursive: true, mode: 0o755 });
    }

    // 动态生成 WebP 缩略图
    await sharp(originalPath)
      .rotate() // 自动根据 EXIF 方向矫正
      .resize({
        width: maxWidth,
        withoutEnlargement: true,
        fit: "inside",
      })
      .webp({ quality: 80, effort: 4 })
      .toFile(cachePath);

    return { path: cachePath, mime: "image/webp" };
  } catch (err) {
    // 处理异常（例如非标准图片文件格式），优雅回退到原图
    const ext = originalPath.split(".").pop()?.toLowerCase() ?? "";
    const mimeMap: Record<string, string> = {
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      gif: "image/gif",
      webp: "image/webp",
    };
    return {
      path: originalPath,
      mime: mimeMap[ext] ?? "application/octet-stream",
    };
  }
}
