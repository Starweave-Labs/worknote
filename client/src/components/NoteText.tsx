/**
 * 待办说明渲染:纯文本 + 内嵌 Markdown 图片引用(![说明](路径))。
 *
 * 新建/编辑待办时粘贴的截图由后端把引用拼在说明(note)文本尾部,
 * 说明本身按纯文本存储。
 * - 列表行(不传 onImageClick):不渲染 <img> 缩略大图,转为轻量「图片」徽标,避免列表行臃肿;
 * - 详情弹窗(传 onImageClick):渲染缩略图,点击进灯箱查看大图。
 */

import { PhotoIcon } from "@heroicons/react/24/outline";
import { ThumbImage, toThumbUrl, toOriginalUrl } from "./ThumbImage";
import type { LightboxImage } from "./Lightbox";

const IMG_MD_RE = /!\[([^\]]*)\]\(([^)]+)\)/g;
/** 连续的一个或多个图片引用(用空白隔开),用于非图片展示态合并为单个计数徽标。 */
const CONSECUTIVE_IMG_RE = /!\[[^\]]*\]\([^)]+\)(?:\s*!\[[^\]]*\]\([^)]+\))*/g;

/** 行内完成标记:`**已于 YYYY-MM-DD [HH:MM] 完成**`(写在说明段尾部)。 */
export const DONE_MARK_RE = /\*\*已于 (\d{4}-\d{2}-\d{2}(?: \d{2}:\d{2})?) 完成\*\*/g;

/**
 * 把说明拆成「纯文本」与「完成时间」两部分。
 * 仅用于展示层:说明渲染时去掉原始完成标记,完成时间单独展示。
 */
export function splitDoneMark(note: string): { text: string; doneAt: string } {
  let doneAt = "";
  const text = note
    .replace(DONE_MARK_RE, (_m, stamp: string) => {
      doneAt = stamp;
      return "";
    })
    .replace(/\s{2,}/g, " ")
    .trim();
  return { text, doneAt };
}

export function NoteText({
  text,
  imageUrl,
  onImageClick,
  showImages,
}: {
  text: string;
  imageUrl?: (src: string) => string;
  onImageClick?: (img: LightboxImage) => void;
  /** 是否渲染具体图片缩略图。列表行默认为 false(只显示 [图片] 标记),详情弹窗(传入 onImageClick)默认为 true。 */
  showImages?: boolean;
}) {
  const shouldShowImages = showImages ?? Boolean(onImageClick);
  const out: React.ReactNode[] = [];
  let last = 0;
  let k = 0;

  if (!shouldShowImages) {
    CONSECUTIVE_IMG_RE.lastIndex = 0;
    IMG_MD_RE.lastIndex = 0;
    let cm: RegExpExecArray | null;
    while ((cm = CONSECUTIVE_IMG_RE.exec(text))) {
      if (cm.index > last) out.push(text.slice(last, cm.index));
      const count = (cm[0].match(IMG_MD_RE) || []).length;
      out.push(
        <span
          key={k++}
          className="mx-0.5 inline-flex items-center gap-0.5 rounded border border-line bg-surface-2 px-1.5 py-px text-[11px] text-ink-muted align-middle"
          title={`包含 ${count} 张图片附件，点击待办可查看大图`}
        >
          <PhotoIcon className="h-3 w-3" />
          <span>图片{count > 1 ? ` (${count})` : ""}</span>
        </span>,
      );
      last = cm.index + cm[0].length;
    }
  } else {
    IMG_MD_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = IMG_MD_RE.exec(text))) {
      if (m.index > last) out.push(text.slice(last, m.index));
      if (imageUrl) {
        const alt = m[1].trim();
        const rawUrl = imageUrl(m[2].trim());
        const fullUrl = toOriginalUrl(rawUrl);
        const thumbUrl = toThumbUrl(rawUrl);

        const img = (
          <ThumbImage
            key={k++}
            src={thumbUrl}
            alt={alt || "附件"}
            className="block max-h-[110px] max-w-[220px] rounded-md border border-line object-cover object-top"
          />
        );
        out.push(
          onImageClick ? (
            <button
              key={k++}
              type="button"
              onClick={() => onImageClick({ url: fullUrl, thumbUrl, alt })}
              className="img-cell group relative mt-1 block max-w-[220px] cursor-pointer overflow-hidden rounded-md border-none bg-transparent p-0"
            >
              {img}
            </button>
          ) : (
            <span key={k++} className="mt-1 block max-w-[220px]">
              {img}
            </span>
          ),
        );
      }
      last = m.index + m[0].length;
    }
  }
  if (last < text.length) out.push(text.slice(last));
  return <>{out}</>;
}
