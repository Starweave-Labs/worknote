/**
 * 响应式轻量缩略图组件。
 *
 * 1. 默认请求带 ?thumb=1 的微缩 WebP 图片（~10KB），代替动辄 2~4MB 的高分辨率原图；
 * 2. 具备轻量骨架占位，图片未就绪时不阻塞文字排版、不产生高度抖动（防止 CLS）；
 * 3. 图片下载完毕后执行 CSS 平滑淡入（fade-in）；
 * 4. 导出通用的 `toThumbUrl` 与 `toOriginalUrl` 转换函数。
 */

import { useState } from "react";

/** 给图片 URL 加上缩略图请求参数 ?thumb=1 */
export function toThumbUrl(url: string, width?: number): string {
  if (!url || url.startsWith("data:") || url.toLowerCase().endsWith(".svg")) return url;
  // 已带 thumb 参数则不重复追加
  if (url.includes("thumb=")) return url;
  const sep = url.includes("?") ? "&" : "?";
  return width ? `${url}${sep}thumb=1&w=${width}` : `${url}${sep}thumb=1`;
}

/** 剥除缩略图参数，获取纯净原图 URL */
export function toOriginalUrl(url: string): string {
  if (!url) return "";
  return url.replace(/[?&]thumb=[^&]*/g, "").replace(/[?&]w=\d+/g, "").replace(/\?$/, "");
}

interface Props extends React.ImgHTMLAttributes<HTMLImageElement> {
  src: string;
  alt?: string;
  /** 期望的缩略图宽度(px),默认 480 */
  thumbWidth?: number;
  /** 是否强制加载原图而非缩略图,默认 false */
  original?: boolean;
}

export function ThumbImage({
  src,
  alt = "附件图片",
  thumbWidth,
  original = false,
  className = "",
  ...rest
}: Props) {
  const [loaded, setLoaded] = useState(false);
  const [err, setErr] = useState(false);

  const finalSrc = original ? toOriginalUrl(src) : toThumbUrl(src, thumbWidth);

  return (
    <span className="relative block h-full w-full overflow-hidden bg-surface-2">
      {/* 未完成加载时的骨架微光 */}
      {!loaded && !err && (
        <span
          aria-hidden="true"
          className="absolute inset-0 block animate-pulse bg-line-soft"
        />
      )}
      <img
        src={finalSrc}
        alt={alt}
        loading="lazy"
        onLoad={() => setLoaded(true)}
        onError={() => {
          setErr(true);
          setLoaded(true);
        }}
        className={`transition-opacity duration-300 ${
          loaded ? "opacity-100" : "opacity-0"
        } ${className}`}
        {...rest}
      />
    </span>
  );
}
