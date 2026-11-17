/**
 * 反馈列表展示:反馈方、时间、文字与图片(只读),可含管理员回复。
 * 登录态(待办详情)可对反馈进行回复;分享页只读(canReply=false)。
 */

import { useState } from "react";
import { api } from "../api";
import { Lightbox, type LightboxImage } from "./Lightbox";
import { ImagePicker, RichTextarea, useImagePicker } from "./ImagePicker";
import { ThumbImage, toThumbUrl, toOriginalUrl } from "./ThumbImage";
import type { TodoFeedback } from "../types";

interface Props {
  items: TodoFeedback[];
  imageUrl: (src: string) => string;
  /** 所属待办(回复接口需要 name+source 定位)。 */
  todo?: { name: string; source: string };
  /** 登录态显示回复入口。 */
  canReply?: boolean;
  /** 回复成功回调(替代 window.location.reload()) */
  onReplied?: () => void;
}

export function FeedbackList({ items, imageUrl, todo, canReply, onReplied }: Props) {
  const [zoom, setZoom] = useState<LightboxImage | null>(null);
  // 正在回复的反馈序号
  const [replying, setReplying] = useState<number | null>(null);
  if (!items.length) return null;

  return (
    <div className="border-t border-line-soft pt-4">
      <div className="mb-2 text-[11.5px] font-semibold uppercase tracking-[0.6px] text-ink-muted">
        反馈 {items.length} 条
      </div>
      <ul className="m-0 list-none space-y-3 p-0">
        {items.map((f, i) => (
          <li key={i} className="rounded-md border border-line-soft bg-surface-2 px-3.5 py-2.5">
            <div className="mb-1 flex flex-wrap items-baseline gap-2 text-[12px]">
              <span className="font-medium text-ink-2">{f.by || "匿名"}</span>
              <span className="text-ink-muted">{f.at}</span>
            </div>
            {f.text && (
              <p className="m-0 whitespace-pre-wrap text-[13.5px] leading-[1.7] text-ink-2">
                {f.text}
              </p>
            )}
            {!!f.images.length && (
              <div className="mt-2 flex flex-wrap gap-2">
                {f.images.map((im, j) => {
                  const rawUrl = imageUrl(im.src);
                  const fullUrl = toOriginalUrl(rawUrl);
                  const thumbUrl = toThumbUrl(rawUrl, 320);
                  return (
                    <button
                      key={j}
                      type="button"
                      onClick={() => setZoom({ url: fullUrl, thumbUrl, alt: im.alt })}
                      className="img-cell h-[92px] w-[122px] cursor-pointer overflow-hidden rounded-md border border-line p-0"
                      aria-label={`放大查看:${im.alt}`}
                    >
                      <ThumbImage
                        src={thumbUrl}
                        alt={im.alt}
                        className="h-full w-full object-cover object-top"
                      />
                    </button>
                  );
                })}
              </div>
            )}

            {f.reply && (f.reply.text || f.reply.images.length > 0) && (
              <div className="mt-2.5 rounded-md border border-line bg-surface px-3 py-2">
                <div className="mb-0.5 flex flex-wrap items-baseline gap-2 text-[12px]">
                  <span className="font-medium text-accent">{f.reply.by || "管理员"}</span>
                  <span className="text-ink-muted">{f.reply.at}</span>
                  <span className="text-ink-muted">· 回复</span>
                </div>
                {f.reply.text && (
                  <p className="m-0 whitespace-pre-wrap text-[13px] leading-[1.7] text-ink-2">
                    {f.reply.text}
                  </p>
                )}
                {!!f.reply.images.length && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {f.reply.images.map((im, j) => {
                      const rawUrl = imageUrl(im.src);
                      const fullUrl = toOriginalUrl(rawUrl);
                      const thumbUrl = toThumbUrl(rawUrl, 320);
                      return (
                        <button
                          key={j}
                          type="button"
                          onClick={() => setZoom({ url: fullUrl, thumbUrl, alt: im.alt })}
                          className="img-cell h-[92px] w-[122px] cursor-pointer overflow-hidden rounded-md border border-line p-0"
                          aria-label={`放大查看:${im.alt}`}
                        >
                          <ThumbImage
                            src={thumbUrl}
                            alt={im.alt}
                            className="h-full w-full object-cover object-top"
                          />
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {canReply && todo && (
              <div className="mt-2">
                {replying === i ? (
                  <ReplyForm
                    todo={todo}
                    fbIndex={i}
                    existing={f.reply}
                    onDone={() => setReplying(null)}
                    onReplied={onReplied}
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => setReplying(i)}
                    className="text-[12px] text-ink-muted underline decoration-line transition hover:text-accent hover:decoration-current"
                  >
                    {f.reply ? "修改回复" : "回复"}
                  </button>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
      <Lightbox image={zoom} onClose={() => setZoom(null)} />
    </div>
  );
}

/** 回复表单(内联):文字 + 可粘贴图片。 */
function ReplyForm({
  todo,
  fbIndex,
  existing,
  onDone,
  onReplied,
}: {
  todo: { name: string; source: string };
  fbIndex: number;
  existing?: TodoFeedback["reply"];
  onDone: () => void;
  onReplied?: () => void;
}) {
  const picker = useImagePicker();
  const [text, setText] = useState(existing?.text ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (!text.trim() && !picker.images.length) {
      setErr("回复内容不能为空");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await api.replyFeedback(
        todo.name,
        todo.source,
        fbIndex,
        text,
        picker.images.map((i) => ({ dataUrl: i.dataUrl, alt: i.name })),
      );
      onDone();
      onReplied?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-md border border-line bg-surface p-3">
      <label className="mb-1.5 block text-[12px] text-ink-muted">
        管理员回复(可直接 Ctrl+V 粘贴截图)
      </label>
      <RichTextarea
        picker={picker}
        value={text}
        onChange={setText}
        rows={3}
        autoFocus
        placeholder="回复反馈…"
      />
      <div className="mt-2">
        <ImagePicker picker={picker} />
      </div>
      {err && <p className="mt-2 text-[12.5px] text-t3">{err}</p>}
      <div className="mt-2.5 flex justify-end gap-2">
        <button
          type="button"
          onClick={onDone}
          className="rounded-md border border-line px-3 py-1 text-[12.5px] text-ink-2 transition hover:border-accent hover:text-accent"
        >
          取消
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={busy}
          className="rounded-md bg-accent px-3 py-1 text-[12.5px] text-white transition hover:bg-accent-hover disabled:opacity-50"
        >
          {busy ? "提交中…" : "提交回复"}
        </button>
      </div>
    </div>
  );
}