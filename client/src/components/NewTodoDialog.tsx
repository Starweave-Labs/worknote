/**
 * 新建待办对话框:手动新建 / AI 新建 两个页签。
 * AI 页签走「分析 -> 预览可编辑 -> 确认落盘」,不直接写入。
 */

import { Dialog, DialogPanel, Transition, TransitionChild } from "@headlessui/react";
import { XMarkIcon, SparklesIcon } from "@heroicons/react/24/outline";
import { Fragment, useEffect, useState } from "react";
import { api } from "../api";
import { TYPE_ORDER, PRIORITY_ORDER } from "../constants";
import { ProjectNotice, useProjects } from "../projects";
import { ImagePicker, RichTextarea, useImagePicker } from "./ImagePicker";
import { TodoProgress } from "./TodoProgress";

interface Props {
  onClose: () => void;
  onCreated: () => void;
}

const DOT = ["bg-t1", "bg-t2", "bg-t3", "bg-t4"];

export function NewTodoDialog({ onClose, onCreated }: Props) {
  const { projects, loading: projectsLoading, error: projectsError } = useProjects();
  const [tab, setTab] = useState<"manual" | "ai">("manual");
  const [aiOk, setAiOk] = useState(false);

  // 表单字段(手动与 AI 预览共用)
  const [project, setProject] = useState("");
  const selectedProject = projects.find((p) => p.slug === project) ?? (!project ? projects[0] : undefined);
  const projectReady = !projectsLoading && !projectsError && !!selectedProject;
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [priority, setPriority] = useState<string>("中");
  const [start, setStart] = useState<string>("");
  const [due, setDue] = useState<string>("");
  const [type, setType] = useState<string>(TYPE_ORDER[0]);
  const [progress, setProgress] = useState(0);

  // AI 输入
  const [prompt, setPrompt] = useState("");
  const picker = useImagePicker();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [analyzed, setAnalyzed] = useState(false);

  useEffect(() => {
    api
      .aiStatus()
      .then((s) => setAiOk(s.configured))
      .catch(() => setAiOk(false));
  }, []);

  async function doAnalyze() {
    if (!prompt.trim() && !picker.images.length) {
      setErr("请先输入文字或选择图片");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const r = await api.aiParseTodo(prompt, picker.images.map((i) => i.dataUrl));
      const d = r.draft;
      setName(d.name);
      setNote(d.note);
      if (d.type) setType(d.type);
      if (d.priority) setPriority(d.priority);
      const matchedProject = projects.find((p) => p.name === d.projectName || p.slug === d.projectName);
      if (matchedProject) setProject(matchedProject.slug);
      setAnalyzed(true);
      if (d.degraded) setErr("AI 未能结构化解析,已填入原文,请自行调整后再确认");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    if (!projectReady || !selectedProject) {
      setErr("请等待项目加载完成，并选择有效的归属项目");
      return;
    }
    if (!name.trim()) {
      setErr("事项名称不能为空");
      return;
    }
    if (busy) return;
    if (start && due && start > due) {
      setErr("预计开始不能晚于预计完成");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const images = picker.images.map((i) => ({ dataUrl: i.dataUrl, alt: i.name }));
      const create = tab === "ai" ? api.aiCreateTodo : api.createTodo;
      await create({
        project: selectedProject.slug,
        name,
        note,
        priority: priority || undefined,
        start: start || undefined,
        due: due || undefined,
        progress,
        type,
        images: images.length ? images : undefined,
      });
      onCreated();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const showPreview = tab === "manual" || analyzed;

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

              <h3 className="m-0 mb-1 text-[17px] font-semibold">新建待办</h3>
              <p className="m-0 mb-4 text-[12.5px] text-ink-muted">
                手动填写,或让 AI 从你的文字/图片里整理。
              </p>

              <div className="mb-3"><ProjectNotice /></div>

              <div className="mb-4 flex rounded-md border border-line p-0.5 text-[13px]">
                <button
                  type="button"
                  onClick={() => setTab("manual")}
                  className={`flex-1 rounded px-3 py-1.5 transition ${
                    tab === "manual" ? "bg-accent-tint text-accent" : "text-ink-muted hover:text-ink"
                  }`}
                >
                  手动新建
                </button>
                <button
                  type="button"
                  disabled={!aiOk}
                  onClick={() => setTab("ai")}
                  title={aiOk ? "" : "后端未配置 AI"}
                  className={`flex flex-1 items-center justify-center gap-1.5 rounded px-3 py-1.5 transition disabled:cursor-not-allowed disabled:opacity-40 ${
                    tab === "ai" ? "bg-accent-tint text-accent" : "text-ink-muted hover:text-ink"
                  }`}
                >
                  <SparklesIcon className="h-4 w-4" />
                  AI 新建
                </button>
              </div>

              {tab === "ai" && (
                <div className="mb-4">
                  <label className="mb-1.5 block text-[12.5px] text-ink-muted">
                    把文字粘贴到下面，或直接 <b>Ctrl+V 粘贴截图</b> / 选择图片
                  </label>
                  <RichTextarea
                    picker={picker}
                    value={prompt}
                    onChange={setPrompt}
                    rows={5}
                    placeholder="例如:客户反馈月报流程走完后台账里看不到数据,需要排查并修复字段映射…(截图可直接粘贴)"
                  />
                  <div className="mt-2">
                    <ImagePicker picker={picker} />
                  </div>
                  <button
                    type="button"
                    onClick={doAnalyze}
                    disabled={busy || !projectReady}
                    className="btn-secondary mt-3"
                  >
                    <SparklesIcon className="h-4 w-4" />
                    {busy ? "分析中…" : analyzed ? "重新分析" : "AI 分析"}
                  </button>
                </div>
              )}

              {showPreview && (
                <div className="border-t border-line-soft pt-4">
                  <Field label="事项名称">
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="w-full rounded-md border border-line bg-surface px-3 py-2 text-[14px] text-ink outline-none transition focus:border-accent"
                      placeholder="一句话概括这件事"
                    />
                  </Field>

                  <Field label="补充说明(可直接 Ctrl+V 粘贴截图)">
                    <RichTextarea
                      picker={picker}
                      value={note}
                      onChange={setNote}
                      rows={3}
                      placeholder="可选，支持直接粘贴截图"
                    />
                    {tab === "manual" && (
                      <div className="mt-2">
                        <ImagePicker picker={picker} />
                      </div>
                    )}
                  </Field>

                  <Field label="归属项目">
                    {!projectsLoading && !projectsError && projects.length > 0 && !selectedProject && (
                      <p role="alert" className="m-0 mb-2 text-[12.5px] text-ink-muted">请重新选择有效的归属项目。</p>
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
                  </Field>

                  <Field label="优先级">
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
                  </Field>

                  <Field label="类型">
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
                  </Field>

                  <Field label="完成进度">
                    <TodoProgress value={progress} onCommit={setProgress} disabled={busy} />
                    <p className="m-0 mt-1 text-[12px] text-ink-muted">
                      {progress === 100 ? "确认新建后将直接完成，并写入当日工作记录。" : "确认新建时保存；设为 100% 会自动完成。"}
                    </p>
                  </Field>

                  <Field label="预计开始">
                    <input
                      type="date"
                      value={start}
                      onChange={(e) => setStart(e.target.value)}
                      className="w-full rounded-md border border-line bg-surface px-3 py-2 text-[14px] text-ink outline-none transition focus:border-accent"
                    />
                  </Field>
                  <Field label="预计完成">
                    <input
                      type="date"
                      value={due}
                      onChange={(e) => setDue(e.target.value)}
                      className="w-full rounded-md border border-line bg-surface px-3 py-2 text-[14px] text-ink outline-none transition focus:border-accent"
                    />
                  </Field>
                </div>
              )}

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
                  disabled={busy || !showPreview || !projectReady}
                  className="btn-primary"
                >
                  {busy ? "保存中…" : "确认新建"}
                </button>
              </div>
            </DialogPanel>
          </TransitionChild>
        </div>
      </Dialog>
    </Transition>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-3.5">
      <label className="mb-1.5 block text-[12.5px] text-ink-muted">{label}</label>
      {children}
    </div>
  );
}