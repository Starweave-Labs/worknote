/**
 * 分享管理对话框(Headless UI Dialog,照 Lightbox 的模式)。
 *
 * 只能在该项目详情页打开:生成 view/edit 链接、列出该项目的既有链接、撤销。
 */

import { Dialog, DialogPanel, Transition, TransitionChild } from "@headlessui/react";
import { XMarkIcon, ClipboardDocumentIcon, TrashIcon, PencilSquareIcon } from "@heroicons/react/24/outline";
import { Fragment, useEffect, useState } from "react";
import { api, useAsync } from "../api";
import type { Share, ShareMode } from "../types";

interface Props {
  project: string;
  projectName: string;
  onClose: () => void;
}

function shareUrl(token: string): string {
  return `${window.location.origin}/share/${token}`;
}

export function ShareDialog({ project, projectName, onClose }: Props) {
  const { data, loading, error } = useAsync(() => api.shares(), []);
  const [items, setItems] = useState<Share[]>([]);
  const [mode, setMode] = useState<ShareMode>("view");
  const [feedbackBy, setFeedbackBy] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  // 编辑中的分享(token 为键)
  const [editing, setEditing] = useState<string | null>(null);
  const [editMode, setEditMode] = useState<ShareMode>("view");
  const [editBy, setEditBy] = useState("");
  const [editBusy, setEditBusy] = useState(false);

  useEffect(() => {
    if (data) setItems(data.items);
  }, [data]);

  const mine = items.filter((s) => s.project === project);

  async function create() {
    if (mode === "edit" && !feedbackBy.trim()) {
      setErr("可反馈的链接需填写反馈方");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const s = await api.createShare(project, mode, projectName, feedbackBy.trim());
      setItems((prev) => [s, ...prev]);
      await copy(shareUrl(s.token), s.token);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function copy(text: string, key: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
    } catch {
      /* 剪贴板不可用时,链接仍显示在下方可手动复制 */
    }
  }

  function startEdit(s: Share) {
    setEditing(s.token);
    setEditMode(s.mode);
    setEditBy(s.feedbackBy || "");
    setErr(null);
  }

  async function saveEdit() {
    if (!editing) return;
    if (editMode === "edit" && !editBy.trim()) {
      setErr("可反馈的链接需填写反馈方");
      return;
    }
    setEditBusy(true);
    setErr(null);
    try {
      const updated = await api.updateShare(editing, {
        mode: editMode,
        feedbackBy: editBy.trim(),
      });
      setItems((prev) => prev.map((x) => (x.token === updated.token ? updated : x)));
      setEditing(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setEditBusy(false);
    }
  }

  async function revoke(token: string) {
    await api.revokeShare(token);
    setItems((prev) => prev.filter((s) => s.token !== token));
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
            <DialogPanel className="relative w-full max-w-[540px] rounded-card border border-line bg-surface p-6 shadow-2xl">
              <button
                type="button"
                onClick={onClose}
                aria-label="关闭"
                className="absolute right-4 top-4 cursor-pointer border-none bg-transparent p-1 text-ink-muted transition hover:text-ink"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>

              <h3 className="m-0 mb-1 text-[17px] font-semibold">分享「{projectName}」的待办</h3>
              <p className="m-0 mb-4 text-[12.5px] text-ink-muted">
                「仅查看」纯只读；「可编辑 + 反馈」的链接可勾选完成，也可按待办提交反馈。可随时撤销。
              </p>

              <label className="mb-1.5 block text-[12.5px] text-ink-muted">
                反馈方（对方提交反馈时记为此身份）
              </label>
              <input
                value={feedbackBy}
                onChange={(e) => setFeedbackBy(e.target.value)}
                placeholder="如：甲方测试组、王工"
                className="mb-3 w-full rounded-md border border-line bg-surface px-3 py-2 text-[14px] text-ink outline-none transition focus:border-accent"
              />

              <div className="flex flex-wrap items-center gap-2">
                <div className="flex rounded-md border border-line p-0.5 text-[13px]">
                  {(["view", "edit"] as ShareMode[]).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setMode(m)}
                      className={`rounded px-3 py-1 transition ${
                        mode === m ? "bg-accent-tint text-accent" : "text-ink-muted hover:text-ink"
                      }`}
                    >
                      {m === "view" ? "仅查看" : "可编辑 + 反馈"}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={create}
                  disabled={busy}
                  className="rounded-md bg-accent px-4 py-1.5 text-[13.5px] text-white transition hover:bg-accent-hover disabled:opacity-50"
                >
                  {busy ? "生成中…" : "生成链接"}
                </button>
              </div>

              {err && <p className="mb-2 text-[13px] text-t3">{err}</p>}

              <h4 className="section-title mb-2 mt-6 text-[13px]">
                {project === "_all" ? "全库待办现有链接" : "该项目现有链接"}
              </h4>
              {loading && <p className="py-2 text-[13px] text-ink-muted">加载中…</p>}
              {error && <p className="py-2 text-[13px] text-t3">加载失败:{error}</p>}
              {!loading && !mine.length && (
                <p className="py-2 text-[13px] text-ink-muted">暂无链接</p>
              )}
              <ul className="m-0 list-none p-0">
                {mine.map((s) => (
                  <li
                    key={s.token}
                    className="border-t border-line-soft py-2.5 first:border-t-0"
                  >
                    <div className="flex items-center gap-3">
                    <span className="flex-none rounded border border-line bg-surface-2 px-1.5 py-px text-[11.5px] text-ink-2">
                      {s.mode === "edit" ? "可编辑" : "仅查看"}
                    </span>
                    {s.mode === "edit" && s.feedbackBy && (
                      <span className="flex-none text-[11.5px] text-ink-muted" title="反馈方">
                        {s.feedbackBy}
                      </span>
                    )}
                    <code className="min-w-0 flex-1 truncate text-[12px] text-ink-muted" title={shareUrl(s.token)}>
                      {shareUrl(s.token)}
                    </code>
                    <button
                      type="button"
                      onClick={() => startEdit(s)}
                      className="flex-none text-ink-muted transition hover:text-accent"
                      aria-label="编辑权限"
                    >
                      <PencilSquareIcon className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => copy(shareUrl(s.token), s.token)}
                      className="flex-none text-ink-muted transition hover:text-accent"
                      aria-label="复制链接"
                    >
                      {copied === s.token ? (
                        <span className="text-[12px] text-accent">已复制</span>
                      ) : (
                        <ClipboardDocumentIcon className="h-4 w-4" />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => revoke(s.token)}
                      className="flex-none text-ink-muted transition hover:text-t3"
                      aria-label="撤销链接"
                    >
                      <TrashIcon className="h-4 w-4" />
                    </button>
                    </div>

                    {editing === s.token && (
                      <div className="mt-2 rounded-md border border-line bg-surface-2 px-3 py-2.5">
                        <div className="mb-2 flex flex-wrap items-center gap-2">
                          <div className="flex rounded-md border border-line bg-surface p-0.5 text-[12.5px]">
                            {(["view", "edit"] as ShareMode[]).map((m) => (
                              <button
                                key={m}
                                type="button"
                                onClick={() => setEditMode(m)}
                                className={`rounded px-2.5 py-0.5 transition ${
                                  editMode === m ? "bg-accent-tint text-accent" : "text-ink-muted hover:text-ink"
                                }`}
                              >
                                {m === "view" ? "仅查看" : "可编辑 + 反馈"}
                              </button>
                            ))}
                          </div>
                          <input
                            value={editBy}
                            onChange={(e) => setEditBy(e.target.value)}
                            placeholder="反馈方(如:甲方测试组)"
                            className="min-w-[140px] flex-1 rounded-md border border-line bg-surface px-2.5 py-1 text-[13px] text-ink outline-none transition focus:border-accent"
                          />
                          <button
                            type="button"
                            onClick={saveEdit}
                            disabled={editBusy}
                            className="rounded-md bg-accent px-3 py-1 text-[12.5px] text-white transition hover:bg-accent-hover disabled:opacity-50"
                          >
                            {editBusy ? "保存中…" : "保存"}
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditing(null)}
                            className="rounded-md border border-line px-3 py-1 text-[12.5px] text-ink-2 transition hover:border-accent hover:text-accent"
                          >
                            取消
                          </button>
                        </div>
                        <p className="m-0 text-[11.5px] text-ink-muted">
                          修改后链接不变,对方无需重新获取。
                        </p>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </DialogPanel>
          </TransitionChild>
        </div>
      </Dialog>
    </Transition>
  );
}