/**
 * 完成待办对话框:填写完成情况(文字 + 图片),可选让 AI 整理成书面说明。
 */

import { Dialog, DialogPanel, Transition, TransitionChild } from "@headlessui/react";
import { XMarkIcon, SparklesIcon } from "@heroicons/react/24/outline";
import { Fragment, useState } from "react";
import { api } from "../api";
import { ImagePicker, RichTextarea, useImagePicker } from "./ImagePicker";
import type { TodoItem, TodoMutationResponse } from "../types";

interface Props {
  item: TodoItem;
  project: string;
  onClose: () => void;
  onCompleted: (result: TodoMutationResponse) => void;
}

export function CompleteTodoDialog({ item, project, onClose, onCompleted }: Props) {
  const picker = useImagePicker();
  const [text, setText] = useState("");
  const [analyze, setAnalyze] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const result = await api.completeTodo({
        name: item.name,
        source: item.source,
        project,
        text,
        images: picker.images.map((i) => ({ dataUrl: i.dataUrl, alt: i.name })),
        analyze: analyze && !!text.trim(),
      });
      onCompleted(result);
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
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
            <DialogPanel className="relative max-h-[90vh] w-full max-w-[560px] overflow-y-auto rounded-card border border-line bg-surface p-6 shadow-2xl">
              <button
                type="button"
                onClick={onClose}
                aria-label="关闭"
                className="absolute right-4 top-4 cursor-pointer border-none bg-transparent p-1 text-ink-muted transition hover:text-ink"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>

              <h3 className="m-0 mb-1 text-[17px] font-semibold">标记完成</h3>
              <p className="m-0 mb-2 text-[12.5px] text-ink-muted">{item.name}</p>
              <p className="m-0 mb-4 text-[12.5px] text-ink-2">确认后进度将设为 100%，并将完成情况写入当日工作记录。</p>

              <label className="mb-1.5 block text-[12.5px] text-ink-muted">
                完成情况（可直接 <b>Ctrl+V 粘贴截图</b>）
              </label>
              <RichTextarea
                picker={picker}
                value={text}
                onChange={setText}
                rows={4}
                autoFocus
                placeholder="做了什么、结果如何…(可留空直接完成，截图可直接粘贴)"
              />

              <label className="mt-2 flex cursor-pointer items-center gap-2 text-[12.5px] text-ink-2">
                <input
                  type="checkbox"
                  checked={analyze}
                  onChange={(e) => setAnalyze(e.target.checked)}
                  className="h-3.5 w-3.5 accent-[#24557f]"
                />
                <span className="inline-flex items-center gap-1">
                  <SparklesIcon className="h-3.5 w-3.5" />
                  让 AI 整理成书面说明(依据上方文字与图片)
                </span>
              </label>

              <div className="mt-3">
                <ImagePicker picker={picker} />
              </div>

              {/* 完成示例预览:确认后将呈现的样子(即"已完成的示例") */}
              {(text.trim() || picker.images.length > 0) && (
                <div className="mt-4 rounded-md border border-line bg-surface-2 p-3.5">
                  <div className="mb-1.5 text-[11.5px] font-semibold uppercase tracking-[0.6px] text-ink-muted">
                    完成示例预览
                  </div>
                  <div className="text-[14px] text-ink-muted line-through decoration-line">
                    {item.name}
                  </div>
                  {text.trim() && (
                    <p className="m-0 mt-1 whitespace-pre-wrap text-[13.5px] leading-[1.7] text-ink-2">
                      {text.trim()}
                    </p>
                  )}
                  {!!picker.images.length && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {picker.images.map((im, i) => (
                        <img
                          key={i}
                          src={im.dataUrl}
                          alt={im.name}
                          className="h-[80px] w-[106px] rounded-md border border-line object-cover object-top"
                        />
                      ))}
                    </div>
                  )}
                  <p className="m-0 mt-2 text-[11.5px] text-ink-muted">
                    确认后：该待办转为已完成，并将此内容写入当日工作记录。
                  </p>
                </div>
              )}

              {err && <p className="mt-3 text-[13px] text-t3">{err}</p>}

              <div className="mt-5 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-md border border-line px-4 py-1.5 text-[13.5px] text-ink-2 transition hover:border-accent hover:text-accent"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={submit}
                  disabled={busy}
                  className="rounded-md bg-accent px-4 py-1.5 text-[13.5px] text-white transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busy ? "处理中…" : analyze && text.trim() ? "AI 整理并完成" : "确认完成"}
                </button>
              </div>
            </DialogPanel>
          </TransitionChild>
        </div>
      </Dialog>
    </Transition>
  );
}