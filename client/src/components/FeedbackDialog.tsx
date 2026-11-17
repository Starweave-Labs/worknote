/**
 * 反馈对话框(分享页使用):按待办提交反馈文字 + 图片。
 * 反馈方由分享链接固定(feedbackBy),在此只读展示。
 */

import { Dialog, DialogPanel, Transition, TransitionChild } from "@headlessui/react";
import { XMarkIcon } from "@heroicons/react/24/outline";
import { Fragment, useState } from "react";
import { api } from "../api";
import { ImagePicker, RichTextarea, useImagePicker } from "./ImagePicker";

interface Props {
  token: string;
  itemName: string;
  source: string;
  feedbackBy: string;
  onClose: () => void;
  onSubmitted: () => void;
}

export function FeedbackDialog({ token, itemName, source, feedbackBy, onClose, onSubmitted }: Props) {
  const picker = useImagePicker();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (!text.trim() && !picker.images.length) {
      setErr("请填写反馈内容或上传图片");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await api.submitFeedback(
        token,
        itemName,
        source,
        text,
        picker.images.map((i) => ({ dataUrl: i.dataUrl, alt: i.name })),
      );
      onSubmitted();
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

              <h3 className="m-0 mb-1 text-[17px] font-semibold">提交反馈</h3>
              <p className="m-0 mb-1 text-[12.5px] text-ink-muted">{itemName}</p>
              <p className="m-0 mb-4 text-[12px] text-ink-muted">
                反馈方：<span className="text-ink-2">{feedbackBy || "未标注"}</span>
                （由链接固定）
              </p>

              <label className="mb-1.5 block text-[12.5px] text-ink-muted">
                反馈内容(可直接 <b>Ctrl+V 粘贴截图</b>)
              </label>
              <RichTextarea
                picker={picker}
                value={text}
                onChange={setText}
                rows={4}
                autoFocus
                placeholder="例如：已测试，功能正常／登录后报错，见截图…(截图可直接粘贴)"
              />

              <div className="mt-3">
                <ImagePicker picker={picker} />
              </div>

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
                  {busy ? "提交中…" : "提交反馈"}
                </button>
              </div>
            </DialogPanel>
          </TransitionChild>
        </div>
      </Dialog>
    </Transition>
  );
}