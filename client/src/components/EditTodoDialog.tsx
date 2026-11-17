/**
 * 编辑待办对话框。
 *
 * 允许修改待办名称、说明、类型、归属项目，且说明栏采用 RichTextarea 支持 Ctrl+V 直接粘贴截图追加。
 */

import { Dialog, DialogPanel, Transition, TransitionChild } from "@headlessui/react";
import { XMarkIcon } from "@heroicons/react/24/outline";
import { Fragment, useState } from "react";
import { api } from "../api";
import { TYPE_ORDER, PRIORITY_ORDER } from "../constants";
import { ProjectNotice, useProjects } from "../projects";
import { ImagePicker, RichTextarea, useImagePicker } from "./ImagePicker";
import { TodoProgress } from "./TodoProgress";
import type { TodoMutationResponse } from "../types";

interface Props {
  item: {
    name: string;
    note: string;
    progress: number;
    priority?: string;
    start?: string;
    due?: string;
    type: string;
    group: string;
    source?: string;
  };
  onClose: () => void;
  onUpdated: (result: TodoMutationResponse) => void;
}

const DOT = ["bg-t1", "bg-t2", "bg-t3", "bg-t4"];

function projectOfGroup(group: string): string {
  return group.split(" · ")[0]?.trim() ?? group;
}

export function EditTodoDialog({ item, onClose, onUpdated }: Props) {
  const { projects, loading: projectsLoading, error: projectsError } = useProjects();
  const [project, setProject] = useState<string | null>(null);
  const originalProject = projectOfGroup(item.group);
  // 当前分组才是归属；来源记录可能仍指向迁移前的项目。
  const selectedProject = project === null
    ? projects.find((p) => p.name === originalProject || p.slug === originalProject)
    : projects.find((p) => p.slug === project);
  const projectReady = !projectsLoading && !projectsError && !!selectedProject;
  const [name, setName] = useState(item.name);
  const [note, setNote] = useState(item.note);
  const [priority, setPriority] = useState<string>(item.priority || "");
  const [start, setStart] = useState<string>(item.start || "");
  const [due, setDue] = useState<string>(item.due || "");
  const [type, setType] = useState<string>(item.type || TYPE_ORDER[0]);
  const [progress, setProgress] = useState(item.progress);

  const picker = useImagePicker();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (busy) return;
    if (!projectReady || !selectedProject) {
      setErr("请等待项目加载完成，并选择有效的归属项目");
      return;
    }
    if (!name.trim()) {
      setErr("事项名称不能为空");
      return;
    }
    if (start && due && start > due) {
      setErr("预计开始不能晚于预计完成");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const images = picker.images.map((i) => ({ dataUrl: i.dataUrl, alt: i.name }));
      const result = await api.updateTodo(item.name, item.source ?? "", {
        name: name.trim(),
        note,
        priority: priority || "",
        start: start || "",
        due: due || "",
        ...(progress !== item.progress ? { progress } : {}),
        type,
        project: selectedProject.slug,
        images: images.length ? images : undefined,
      });
      onUpdated(result);
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

              <h3 className="m-0 mb-1 text-[17px] font-semibold">编辑待办</h3>
              <p className="m-0 mb-4 text-[12.5px] text-ink-muted">
                修改待办内容或归属，原有的完成情况与用户反馈将继续保留。
              </p>

              <div className="space-y-3.5">
                <div>
                  <label className="mb-1.5 block text-[12.5px] text-ink-muted">事项名称</label>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full rounded-md border border-line bg-surface px-3 py-2 text-[14px] text-ink outline-none transition focus:border-accent"
                    placeholder="事项名称"
                    autoFocus
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-[12.5px] text-ink-muted">
                    补充说明（可直接 <b>Ctrl+V 粘贴截图</b>）
                  </label>
                  <RichTextarea
                    picker={picker}
                    value={note}
                    onChange={setNote}
                    rows={4}
                    placeholder="补充说明，支持直接粘贴截图"
                  />
                  <div className="mt-2">
                    <ImagePicker picker={picker} />
                  </div>
                </div>

                <div>
                  <label className="mb-1.5 block text-[12.5px] text-ink-muted">归属项目</label>
                  <ProjectNotice />
                  {!projectsLoading && !projectsError && projects.length > 0 && !selectedProject && (
                    <p role="alert" className="m-0 mb-2 text-[12.5px] text-ink-muted">
                      原归属项目未在目录中登记，请选择有效项目后保存；不会自动改归属。
                    </p>
                  )}
                  <div className="flex flex-wrap gap-1.5">
                    {projects.map(({ slug, name: label }) => (
                      <button
                        key={slug}
                        type="button"
                        onClick={() => setProject(slug)}
                        disabled={busy || projectsLoading || !!projectsError}
                        aria-pressed={selectedProject?.slug === slug}
                        className={`btn-secondary ${
                          selectedProject?.slug === slug ? "border-accent bg-accent-tint text-accent" : ""
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="mb-1.5 block text-[12.5px] text-ink-muted">优先级</label>
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() => setPriority("")}
                      className={`rounded-full border px-3 py-1 text-[12.5px] transition ${
                        !priority
                          ? "border-accent bg-accent-tint font-medium text-accent"
                          : "border-line text-ink-muted hover:border-accent hover:text-accent"
                      }`}
                    >
                      默认(无)
                    </button>
                    {PRIORITY_ORDER.map((p) => {
                      const dot = p === "高" ? "bg-accent" : p === "中" ? "bg-t2" : "bg-ink-muted";
                      return (
                        <button
                          key={p}
                          type="button"
                          onClick={() => setPriority(p)}
                          className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12.5px] transition ${
                            priority === p
                              ? "border-accent bg-accent-tint font-medium text-accent"
                              : "border-line text-ink-2 hover:border-accent hover:text-accent"
                          }`}
                        >
                          <span className={`inline-block h-1.5 w-1.5 rounded-sm ${dot}`} />
                          {p}优
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <label className="mb-1.5 block text-[12.5px] text-ink-muted">类型</label>
                  <div className="flex flex-wrap gap-1.5">
                    {TYPE_ORDER.map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setType(t)}
                        className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12.5px] transition ${
                          type === t
                            ? "border-accent bg-accent-tint text-accent"
                            : "border-line text-ink-2 hover:border-accent hover:text-accent"
                        }`}
                      >
                        <span
                          className={`inline-block h-1.5 w-1.5 rounded-sm ${DOT[TYPE_ORDER.indexOf(t)]}`}
                        />
                        {t}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="mb-1.5 text-[12.5px] text-ink-muted">完成进度</div>
                  <TodoProgress value={progress} onCommit={setProgress} disabled={busy} />
                  <p className="m-0 mt-1 text-[12px] text-ink-muted">
                    {progress === 100 && item.progress < 100
                      ? "保存后将自动完成，并写入当日工作记录。"
                      : progress < 100 && item.progress === 100
                        ? "保存后将重新打开该待办，保留完成情况与反馈。"
                        : "点击保存修改后生效；取消时放弃本次调整。"}
                  </p>
                </div>

                <div className="flex gap-3">
                  <div className="min-w-0 flex-1">
                    <label className="mb-1.5 block text-[12.5px] text-ink-muted">预计开始</label>
                    <input
                      type="date"
                      value={start}
                      onChange={(e) => setStart(e.target.value)}
                      className="w-full rounded-md border border-line bg-surface px-3 py-2 text-[14px] text-ink outline-none transition focus:border-accent"
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <label className="mb-1.5 block text-[12.5px] text-ink-muted">预计完成</label>
                    <input
                      type="date"
                      value={due}
                      onChange={(e) => setDue(e.target.value)}
                      className="w-full rounded-md border border-line bg-surface px-3 py-2 text-[14px] text-ink outline-none transition focus:border-accent"
                    />
                  </div>
                </div>
              </div>

              {err && <p className="mt-3 text-[13px] text-t3">{err}</p>}

              <div className="mt-5 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="btn-secondary"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={submit}
                  disabled={busy || !projectReady}
                  className="btn-primary"
                >
                  {busy ? "保存中…" : "保存修改"}
                </button>
              </div>
            </DialogPanel>
          </TransitionChild>
        </div>
      </Dialog>
    </Transition>
  );
}
