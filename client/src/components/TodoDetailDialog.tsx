/**
 * 待办详情对话框。
 *
 * 两处复用:登录后的待办清单、免登录的分享页。
 * `imageUrl` 用于把 todo.md 里的仓库相对路径转成实际可访问的 URL
 * (登录态走 /attachments... 分享页走 token 附件路由)。
 * 登录态(canToggleDone=true)可直接在弹窗内切换完成状态(完成或从完成取消)。
 */

import { Dialog, DialogPanel, Transition, TransitionChild } from "@headlessui/react";
import { XMarkIcon, ArrowUturnLeftIcon, CheckIcon, PencilSquareIcon, TrashIcon } from "@heroicons/react/24/outline";
import { Fragment, useState } from "react";
import { Lightbox, type LightboxImage } from "./Lightbox";
import { FeedbackList } from "./FeedbackList";
import { NoteText, splitDoneMark } from "./NoteText";
import { ThumbImage, toThumbUrl, toOriginalUrl } from "./ThumbImage";
import { TypeTag, PriorityTag, DueTag } from "./Tags";
import type { TodoCompletion, TodoFeedback } from "../types";
import { TodoProgress } from "./TodoProgress";

export interface DetailItem {
  name: string;
  note: string;
  progress: number;
  priority?: string;
  start?: string;
  due?: string;
  type: string;
  group: string;
  source?: string;
  sourceText?: string;
  created?: boolean;
  completion?: TodoCompletion;
  feedback?: TodoFeedback[];
}

interface Props {
  item: DetailItem;
  done: boolean;
  /** 仓库相对路径 -> 可访问 URL。 */
  imageUrl: (src: string) => string;
  /** 登录态允许回复反馈。 */
  canReply?: boolean;
  /** 登录态允许切换完成状态。 */
  canToggleDone?: boolean;
  /** 只有登录页面提供;分享页始终只读。 */
  onProgressCommit?: (progress: number) => Promise<void>;
  busy?: boolean;
  /** 触发打开完成弹窗。 */
  onStartComplete?: () => void;
  /** 触发取消完成。 */
  onUndone?: () => void;
  /** 触发编辑。 */
  onEdit?: () => void;
  /** 触发删除。 */
  onDelete?: () => void;
  /** 回复反馈成功回调 */
  onFeedbackReplied?: () => void;
  onClose: () => void;
}

export function TodoDetailDialog({
  item,
  done,
  imageUrl,
  canReply,
  canToggleDone,
  onProgressCommit,
  busy,
  onStartComplete,
  onUndone,
  onEdit,
  onDelete,
  onFeedbackReplied,
  onClose,
}: Props) {
  const [zoom, setZoom] = useState<LightboxImage | null>(null);
  const imgs = item.completion?.images ?? [];
  const { text: noteText, doneAt } = splitDoneMark(item.note);

  return (
    <>
      <Transition show as={Fragment}>
        <Dialog onClose={onClose} className="relative z-[1000]">
          <TransitionChild
            as={Fragment}
            enter="ease-out duration-200"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="ease-in duration-150"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <div className="fixed inset-0 bg-[rgba(12,15,19,0.55)]" aria-hidden="true" />
          </TransitionChild>

          <div className="fixed inset-0 flex items-center justify-center p-4">
            <TransitionChild
              as={Fragment}
              enter="ease-out duration-200"
              enterFrom="opacity-0 scale-[0.97]"
              enterTo="opacity-100 scale-100"
              leave="ease-in duration-150"
              leaveFrom="opacity-100 scale-100"
              leaveTo="opacity-0 scale-[0.97]"
            >
              <DialogPanel className="relative max-h-[88vh] w-full max-w-[600px] overflow-y-auto rounded-card border border-line bg-surface p-6 shadow-2xl">
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="关闭"
                  className="absolute right-4 top-4 cursor-pointer border-none bg-transparent p-1 text-ink-muted transition hover:text-ink"
                >
                  <XMarkIcon className="h-5 w-5" />
                </button>

                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <DueTag due={item.due} done={done} />
                  <PriorityTag priority={item.priority} />
                  <TypeTag type={item.type} />
                  {item.group && <span className="text-[12px] text-ink-muted">{item.group}</span>}
                  {item.created && (
                    <span className="rounded border border-line bg-surface-2 px-1.5 py-px text-[11.5px] text-ink-muted">
                      本站新建
                    </span>
                  )}
                  {done ? (
                    <span className="rounded border border-line bg-surface-2 px-1.5 py-px text-[11.5px] text-ink-muted">
                      已完成
                    </span>
                  ) : (
                    <span className="rounded border border-line bg-surface-2 px-1.5 py-px text-[11.5px] text-accent">
                      未完成
                    </span>
                  )}
                </div>

                <h3 className="m-0 mb-3 text-[17px] font-semibold leading-[1.5]">{item.name}</h3>

                {(done || item.due || item.start) && (
                  <div className="mb-3 text-[12.5px] text-ink-muted">
                    {done && doneAt && <>完成时间:{doneAt}</>}
                    {done && doneAt && (item.start || item.due) && <> · </>}
                    {item.start && item.due && <>预计:{item.start} → {item.due}</>}
                    {!item.start && item.due && <>预计完成:{item.due}</>}
                    {item.start && !item.due && <>预计开始:{item.start}</>}
                  </div>
                )}

                <div className="mb-4 rounded-md border border-line bg-surface px-3 py-2">
                  <div className="mb-1 text-[12.5px] text-ink-2">完成进度</div>
                  <TodoProgress
                    value={item.progress}
                    label={`${item.name}完成进度`}
                    readOnly={!onProgressCommit}
                    onCommit={onProgressCommit}
                    showInput={!!onProgressCommit}
                    disabled={busy}
                  />
                  {onProgressCommit && <p className="m-0 mt-1 text-[11.5px] text-ink-muted">拖动松手或松开方向键保存；100% 自动完成，降低进度可重新打开。</p>}
                </div>

                {noteText && (
                  <div className="mb-4 text-[13.5px] leading-[1.75] text-ink-2">
                    <NoteText text={noteText} imageUrl={imageUrl} onImageClick={setZoom} />
                  </div>
                )}

                {item.source && (
                  <div className="mb-4 text-[12.5px] text-ink-muted">
                    来源:
                    <a
                      href={item.source.startsWith("http") ? item.source : "#"}
                      onClick={(e) => e.preventDefault()}
                      className="ml-1 text-ink-muted"
                    >
                      {item.sourceText || item.source}
                    </a>
                  </div>
                )}

                {canToggleDone && (
                  <div className="mb-4 flex flex-wrap items-center gap-2 border-y border-line-soft py-2.5">
                    <span className="text-[12.5px] text-ink-muted">操作:</span>
                    {done ? (
                      <button
                        type="button"
                        onClick={onUndone}
                        disabled={busy}
                        className="btn-secondary"
                      >
                        <ArrowUturnLeftIcon className="h-3.5 w-3.5" />
                        从已完成取消(标记为未完成)
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={onStartComplete}
                        disabled={busy}
                        className="btn-primary"
                      >
                        <CheckIcon className="h-3.5 w-3.5" />
                        标记完成
                      </button>
                    )}
                    {onEdit && (
                      <button
                        type="button"
                        onClick={onEdit}
                        disabled={busy}
                        className="btn-secondary"
                      >
                        <PencilSquareIcon className="h-3.5 w-3.5" />
                        编辑
                      </button>
                    )}
                    {onDelete && (
                      <button
                        type="button"
                        onClick={onDelete}
                        disabled={busy}
                        className="btn-secondary"
                      >
                        <TrashIcon className="h-3.5 w-3.5" />
                        删除
                      </button>
                    )}
                  </div>
                )}

                {item.completion && (item.completion.text || imgs.length > 0) && (
                  <div className="border-t border-line-soft pt-4">
                    <div className="mb-1.5 text-[11.5px] font-semibold uppercase tracking-[0.6px] text-ink-muted">
                      完成情况
                    </div>
                    {item.completion.text && (
                      <p className="m-0 whitespace-pre-wrap text-[13.5px] leading-[1.75] text-ink-2">
                        {item.completion.text}
                      </p>
                    )}
                    {!!imgs.length && (
                      <div className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
                        {imgs.map((im, i) => {
                          const rawUrl = imageUrl(im.src);
                          const fullUrl = toOriginalUrl(rawUrl);
                          const thumbUrl = toThumbUrl(rawUrl);
                          return (
                            <figure key={i} className="m-0">
                              <button
                                type="button"
                                onClick={() => setZoom({ url: fullUrl, thumbUrl, alt: im.alt })}
                                className="img-cell group relative block h-[110px] w-full cursor-pointer overflow-hidden rounded-md border border-line p-0"
                              >
                                <ThumbImage
                                  src={thumbUrl}
                                  alt={im.alt}
                                  className="h-full w-full object-cover object-top"
                                />
                              </button>
                              {im.alt && (
                                <figcaption className="mt-1 text-[11.5px] text-ink-muted">
                                  {im.alt}
                                </figcaption>
                              )}
                            </figure>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {item.feedback && (
                  <FeedbackList
                    items={item.feedback}
                    imageUrl={imageUrl}
                    canReply={canReply}
                    todo={{ name: item.name, source: item.source ?? "" }}
                    onReplied={onFeedbackReplied}
                  />
                )}
              </DialogPanel>
            </TransitionChild>
          </div>
        </Dialog>
      </Transition>

      <Lightbox image={zoom} onClose={() => setZoom(null)} />
    </>
  );
}