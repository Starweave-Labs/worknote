import { Link, useParams } from "react-router-dom";
import { useRef, useState } from "react";
import { ShareIcon } from "@heroicons/react/24/outline";
import { api, useAsync } from "../api";
import { useAuth } from "../auth";
import { Metabox, Placeholder } from "../components/Metabox";
import { DistBar, TypePills } from "../components/Tags";
import { ShareDialog } from "../components/ShareDialog";
import { TYPE_ORDER } from "../constants";
import type { ModuleStatus } from "../types";

const DOT = ["bg-t1", "bg-t2", "bg-t3", "bg-t4"];

export function ProjectPage() {
  const { slug = "" } = useParams();
  const { authed } = useAuth();
  const { data, loading, error } = useAsync(() => api.project(slug), [slug]);
  const [shareOpen, setShareOpen] = useState(false);
  const [showAllMods, setShowAllMods] = useState(false);

  if (loading) return <Placeholder kind="loading" text="加载中..." />;
  if (error) return <Placeholder kind="error" text={`加载失败:${error}`} />;
  if (!data) return null;

  const maxMod = Math.max(1, data.modules[0]?.count ?? 0);
  const dates = (data.dateRange ?? []).filter(Boolean).sort();
  const firstDate = dates[0];
  const lastDate = dates[dates.length - 1];

  return (
    <>
      <div className="flex items-center gap-4 pt-10">
        <div className="flex h-12 w-12 flex-none items-center justify-center rounded-[10px] border border-line bg-accent-tint text-[20px] font-semibold text-accent">
          {data.name[0]}
        </div>
        <div className="min-w-0">
          <h1 className="m-0 mb-0.5 text-[24px] font-semibold tracking-[-0.3px]">{data.name}</h1>
          <p className="m-0 text-[13px] text-ink-muted">
            {data.systems.join(" · ") || "工作记录"}
          </p>
        </div>
        {authed && (
          <button
            type="button"
            onClick={() => setShareOpen(true)}
            className="ml-auto flex flex-none items-center gap-1.5 rounded-md border border-line bg-surface px-3 py-1.5 text-[13px] text-ink-2 transition hover:border-accent hover:text-accent"
          >
            <ShareIcon className="h-4 w-4" />
            分享待办
          </button>
        )}
      </div>

      <Metabox
        items={[
          {
            label: "记录",
            value: (
              <>
                {data.entryCount}
                <span className="ml-0.5 text-[12.5px] font-normal text-ink-muted">条</span>
              </>
            ),
            sub: `${data.dayCount} 天`,
          },
          { label: "日期范围", value: firstDate || "暂无记录", sub: lastDate && lastDate !== firstDate ? `至 ${lastDate}` : undefined },
          { label: "事项类型", value: "\u00a0", sub: <TypePills counts={data.counts} /> },
        ]}
      />

      <h2 className="section-title">事项类型</h2>
      <DistBar counts={data.counts} />

      <ModulesSection slug={data.slug} />

      {data.modules.length > 0 && (
        <>
          <h2 className="section-title">按模块</h2>
          <div className="flex flex-col gap-[11px]">
            {(showAllMods ? data.modules : data.modules.slice(0, 8)).map((m) => (
              <div
                key={m.name}
                className="grid grid-cols-[minmax(0,1.25fr)_1.75fr_34px] items-center gap-3.5 max-sm:grid-cols-[minmax(0,1fr)_34px] max-sm:gap-y-1.5"
              >
                <div className="truncate text-[13px] text-ink-2" title={m.name}>
                  {m.name}
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-line-soft max-sm:col-span-2 max-sm:row-start-2">
                  <div className="h-full rounded-full bg-t1" style={{ width: `${(m.count * 100) / maxMod}%` }} />
                </div>
                <div className="text-right text-[12.5px] tabular-nums text-ink-muted max-sm:row-start-1">
                  {m.count}
                </div>
              </div>
            ))}
            {data.modules.length > 8 && (
              <button
                type="button"
                onClick={() => setShowAllMods((v) => !v)}
                className="self-start text-[12.5px] text-ink-muted underline decoration-line transition hover:text-accent hover:decoration-current"
              >
                {showAllMods ? "收起" : `展开全部 ${data.modules.length} 项`}
              </button>
            )}
          </div>
        </>
      )}

      <h2 className="section-title">按日期</h2>
      {!data.days.length && (
        <Placeholder kind="empty" text="该项目暂无工作记录。可先添加待办或验收模块，也可在收件箱记一笔后归档。" />
      )}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(268px,1fr))] gap-4 max-sm:grid-cols-1">
        {data.days.map((d) => (
          <Link
            key={d.date}
            to={`/days/${data.slug}/${d.date}`}
            className="block rounded-card border border-line bg-surface p-[18px] px-5 text-ink transition-colors hover:border-accent hover:no-underline"
          >
            <div className="mb-2.5 flex items-baseline justify-between">
              <div className="text-[15px] font-semibold tabular-nums tracking-[-0.2px]">{d.date}</div>
              <div className="text-[12.5px] text-ink-muted">星期{d.weekday}</div>
            </div>
            {d.meta.summary && (
              <div className="mb-3 line-clamp-3 text-[12.5px] leading-[1.65] text-ink-muted">
                {d.meta.summary}
              </div>
            )}
            <div className="flex flex-wrap items-baseline gap-3 text-[12.5px] text-ink-muted">
              <span>
                <b className="font-semibold tabular-nums text-ink">{d.entries.length}</b> 条事项
              </span>
              {TYPE_ORDER.filter((t) => d.counts[t]).map((t) => (
                <span key={t}>
                  <span
                    className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-sm align-[1px] ${DOT[TYPE_ORDER.indexOf(t)]}`}
                  />
                  {t} {d.counts[t]}
                </span>
              ))}
            </div>
          </Link>
        ))}
      </div>

      {shareOpen && (
        <ShareDialog project={data.slug} projectName={data.name} onClose={() => setShareOpen(false)} />
      )}
    </>
  );
}

/* ---------------- 模块与验收进度(支持父子两级) ---------------- */

const STATUS_STYLE: Record<ModuleStatus, string> = {
  未开始: "bg-line-soft text-ink-muted",
  进行中: "bg-accent-tint text-accent",
  待验收: "bg-t2/15 text-t2",
  已验收: "bg-t1 text-white",
};
const STATUS_ORDER: ModuleStatus[] = ["未开始", "进行中", "待验收", "已验收"];

function StatusPill({ status }: { status: ModuleStatus }) {
  return <span className={`rounded-full px-2 py-0.5 text-[11.5px] ${STATUS_STYLE[status]}`}>{status}</span>;
}

/**
 * 进度条(可拖动):按住沿轨道拖动即调整 0-100,松手提交;
 * auto(有子模块的父模块)为只读——进度由子模块均值自动计算。
 */
function ProgressTrack({
  value,
  auto,
  onCommit,
}: {
  value: number;
  auto?: boolean;
  onCommit?: (pct: number) => void;
}) {
  const [preview, setPreview] = useState<number | null>(null);
  const ref = useRef<HTMLSpanElement | null>(null);
  const pct = preview ?? value;

  function pctFrom(e: React.PointerEvent): number {
    const r = ref.current!.getBoundingClientRect();
    return Math.max(0, Math.min(100, Math.round(((e.clientX - r.left) / r.width) * 100)));
  }

  return (
    <span
      ref={ref}
      title={auto ? "由子模块进度自动计算" : "拖动调整进度"}
      className={`relative block h-2.5 overflow-visible rounded-full bg-line-soft ${auto ? "cursor-default" : "cursor-ew-resize"}`}
      style={auto ? undefined : { touchAction: "none" }}
      onPointerDown={
        auto
          ? undefined
          : (e) => {
              e.preventDefault();
              e.currentTarget.setPointerCapture(e.pointerId);
              setPreview(pctFrom(e));
            }
      }
      onPointerMove={
        auto ? undefined : (e) => { if (preview !== null) setPreview(pctFrom(e)); }
      }
      onPointerUp={
        auto
          ? undefined
          : (e) => {
              const p = pctFrom(e);
              setPreview(null);
              if (p !== value) onCommit?.(p);
            }
      }
    >
      <span
        className={`block h-2.5 rounded-full transition-[width] duration-150 ${auto ? "bg-t2/70" : "bg-t2"}`}
        style={{ width: `${pct}%` }}
      />
      {preview !== null && (
        <span
          className="pointer-events-none absolute -top-6 rounded bg-ink px-1.5 py-0.5 text-[10px] tabular-nums leading-[1.4] text-white shadow-sm"
          style={{ left: `max(0px, calc(${pct}% - 14px))` }}
        >
          {pct}%
        </span>
      )}
    </span>
  );
}

type Editing = { parent: string; sub?: string };
type FormData = { name: string; status: ModuleStatus; progress: number; note: string };

/** 模块与验收:父/子模块两级登记,手动创建与维护。 */
function ModulesSection({ slug }: { slug: string }) {
  const { data, loading, error, refetch } = useAsync(() => api.projectModules(slug), [slug]);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [form, setForm] = useState<FormData>({ name: "", status: "未开始", progress: 0, note: "" });
  const [addSubFor, setAddSubFor] = useState<string | null>(null);
  const [addSubName, setAddSubName] = useState("");
  const [addName, setAddName] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const inputCls =
    "w-full rounded-md border border-line bg-surface px-2.5 py-1.5 text-[13px] text-ink outline-none transition focus:border-accent";

  function openEditor(parent: string, sub: string | undefined, m: FormData) {
    setEditing({ parent, sub });
    setForm({ name: m.name, status: m.status, progress: m.progress, note: m.note });
    setAddSubFor(null);
    setMsg(null);
  }

  async function save() {
    if (!editing) return;
    const n = form.name.trim();
    if (!n) {
      setMsg("名称不能为空");
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      if (editing.sub === undefined) {
        await api.saveModule(slug, {
          name: n,
          oldName: n === editing.parent ? undefined : editing.parent,
          status: form.status,
          progress: form.progress,
          note: form.note,
        });
      } else {
        await api.saveModule(slug, {
          name: editing.parent,
          sub: n,
          oldSub: n === editing.sub ? undefined : editing.sub,
          status: form.status,
          progress: form.progress,
          note: form.note,
        });
      }
      setEditing(null);
      await refetch();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function addParent() {
    const n = addName.trim();
    if (!n) return;
    setBusy(true);
    setMsg(null);
    try {
      await api.saveModule(slug, { name: n });
      setAddName("");
      await refetch();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function addSub(parent: string) {
    const n = addSubName.trim();
    if (!n) return;
    setBusy(true);
    setMsg(null);
    try {
      await api.saveModule(slug, { name: parent, sub: n });
      setAddSubName("");
      setAddSubFor(null);
      await refetch();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove(parent: string, sub?: string) {
    const label = sub ? `${parent} / ${sub}` : parent;
    if (!window.confirm(`删除模块「${label}」的登记?${sub ? "" : "(连同其全部子模块;仅移除验收登记,不影响记录与待办)"}`)) return;
    setBusy(true);
    try {
      await api.removeModule(slug, parent, sub);
      await refetch();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  /**
   * 水平信息条:状态徽标 + 进度条 + % + 备注 + 日期。
   * 进度条可直接拖动调进度;有子模块的父模块 auto(自动计算,不可拖)。
   */
  const metaCells = (
    m: FormData & { updated: string; subs?: { name: string }[] },
    opts?: { onCommit?: (pct: number) => void },
  ) => (
    <>
      <StatusPill status={m.status} />
      <span className="min-w-[120px] flex-1">
        <ProgressTrack
          value={m.progress}
          auto={!!m.subs?.length}
          onCommit={opts?.onCommit}
        />
      </span>
      <span
        className="w-9 text-right text-[12px] tabular-nums text-ink-muted"
        title={m.subs?.length ? "由子模块自动计算" : undefined}
      >
        {m.progress}%
      </span>
      {m.note && (
        <span className="max-w-[240px] truncate text-[12px] text-ink-muted" title={m.note}>
          {m.note}
        </span>
      )}
      {m.updated && <span className="text-[11.5px] tabular-nums text-ink-muted">{m.updated.slice(5)}</span>}
    </>
  );

  return (
    <section className="mt-7 rounded-card border border-line bg-surface px-5 py-4">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="m-0 text-[15px] font-semibold">模块与验收</h2>
        <span className="text-[12px] text-ink-muted">支持父子两级 · projects/{slug}/modules.md</span>
      </div>

      {loading && <p className="m-0 text-[12.5px] text-ink-muted">加载中…</p>}
      {error && <Placeholder kind="error" text={`模块加载失败：${error}`} />}
      {data && !data.modules.length && (
        <p className="m-0 text-[12.5px] text-ink-muted">
          还没有模块——在下方输入框为该项目创建;模块下可继续添加子模块
        </p>
      )}

      {data?.modules.map((m) => (
        <div key={m.name} className="border-t border-line-soft py-2.5 first:border-t-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="text-[13.5px] font-semibold text-ink">{m.name}</span>
            {metaCells(m, {
              onCommit: (pct) =>
                void api
                  // 不传 status:由服务端按进度联动派生(0/进行中/待验收/已验收)
                  .saveModule(slug, { name: m.name, progress: pct, note: m.note })
                  .then(() => refetch()),
            })}
            {!!m.subs.length && <span className="text-[11.5px] text-ink-muted">子模块 {m.subs.length}</span>}
            <div className="ml-auto flex flex-none items-center gap-1.5">
              <button
                type="button"
                onClick={() => (editing?.parent === m.name && editing.sub === undefined ? setEditing(null) : openEditor(m.name, undefined, m))}
                className="rounded border border-line px-2 py-0.5 text-[12px] text-ink-muted transition hover:border-accent hover:text-accent"
              >
                {editing?.parent === m.name && editing.sub === undefined ? "收起" : "编辑"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setAddSubFor(addSubFor === m.name ? null : m.name);
                  setAddSubName("");
                  setEditing(null);
                }}
                className="rounded border border-line px-2 py-0.5 text-[12px] text-ink-muted transition hover:border-accent hover:text-accent"
              >
                ＋子模块
              </button>
              <button
                type="button"
                onClick={() => void remove(m.name)}
                className="rounded border border-line px-2 py-0.5 text-[12px] text-ink-muted transition hover:border-t3 hover:text-t3"
              >
                删除
              </button>
            </div>
          </div>

          {/* 子模块行 */}
          {m.subs.map((sub) => (
            <div key={sub.name} className="mt-1.5 flex flex-wrap items-center gap-2.5 pl-7">
              <span className="text-[13px] text-ink-2">
                <span className="mr-1 text-ink-muted">└</span>
                {sub.name}
              </span>
              {metaCells(sub, {
                onCommit: (pct) =>
                  void api
                    .saveModule(slug, {
                      name: m.name,
                      sub: sub.name,
                      // 不传 status:进度→状态联动由服务端派生
                      progress: pct,
                      note: sub.note,
                    })
                    .then(() => refetch()),
              })}
              <div className="ml-auto flex flex-none items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => (editing?.parent === m.name && editing.sub === sub.name ? setEditing(null) : openEditor(m.name, sub.name, sub))}
                  className="rounded border border-line px-2 py-0.5 text-[12px] text-ink-muted transition hover:border-accent hover:text-accent"
                >
                  {editing?.parent === m.name && editing.sub === sub.name ? "收起" : "编辑"}
                </button>
                <button
                  type="button"
                  onClick={() => void remove(m.name, sub.name)}
                  className="rounded border border-line px-2 py-0.5 text-[12px] text-ink-muted transition hover:border-t3 hover:text-t3"
                >
                  删除
                </button>
              </div>
            </div>
          ))}

          {/* 添加子模块 */}
          {addSubFor === m.name && (
            <div className="mt-2 flex flex-wrap items-center gap-2 pl-7">
              <input
                value={addSubName}
                onChange={(e) => setAddSubName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void addSub(m.name);
                }}
                placeholder={`「${m.name}」下的子模块名称,回车添加`}
                className={`${inputCls} max-w-[280px]`}
                autoFocus
              />
              <button
                type="button"
                onClick={() => void addSub(m.name)}
                disabled={busy || !addSubName.trim()}
                className="rounded-md border border-line px-3 py-1.5 text-[12.5px] text-ink-2 transition hover:border-accent hover:text-accent disabled:opacity-50"
              >
                添加子模块
              </button>
              <button type="button" onClick={() => setAddSubFor(null)} className="text-[12px] text-ink-muted hover:text-ink">
                取消
              </button>
            </div>
          )}

          {/* 编辑器(父或子) */}
          {editing && editing.parent === m.name && (
            <div className="mt-2.5 flex flex-wrap items-end gap-3 rounded-md bg-canvas/60 p-3">
              <label className="block">
                <div className="mb-1 text-[11.5px] text-ink-muted">{editing.sub === undefined ? "模块名称" : "子模块名称"}</div>
                <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className={`${inputCls} w-52`} />
              </label>
              <div>
                <div className="mb-1 text-[11.5px] text-ink-muted">验收状态</div>
                <div className="flex gap-1">
                  {STATUS_ORDER.map((st) => (
                    <button
                      key={st}
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, status: st }))}
                      className={`rounded-full border px-2.5 py-1 text-[12px] transition ${
                        form.status === st ? "border-accent bg-accent-tint text-accent" : "border-line text-ink-2 hover:border-accent hover:text-accent"
                      }`}
                    >
                      {st}
                    </button>
                  ))}
                </div>
              </div>
              <label className="block">
                <div className="mb-1 text-[11.5px] text-ink-muted">
                  进度(%)
                  {editing.sub === undefined &&
                    (data?.modules.find((x) => x.name === editing.parent)?.subs.length ?? 0) > 0 && (
                      <span className="ml-1 text-ink-muted/80">· 由子模块自动计算</span>
                    )}
                </div>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={form.progress}
                  disabled={
                    editing.sub === undefined &&
                    (data?.modules.find((x) => x.name === editing.parent)?.subs.length ?? 0) > 0
                  }
                  onChange={(e) => setForm((f) => ({ ...f, progress: Math.max(0, Math.min(100, Number(e.target.value))) }))}
                  className={`${inputCls} w-20 disabled:cursor-not-allowed disabled:bg-line-soft disabled:text-ink-muted`}
                />
              </label>
              <label className="block min-w-[180px] flex-1">
                <div className="mb-1 text-[11.5px] text-ink-muted">备注</div>
                <input value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} placeholder="如:待甲方复验" className={inputCls} />
              </label>
              <button
                type="button"
                onClick={() => void save()}
                disabled={busy}
                className="rounded-md bg-accent px-3.5 py-1.5 text-[13px] text-white transition hover:bg-accent-hover disabled:opacity-50"
              >
                保存
              </button>
              <button type="button" onClick={() => setEditing(null)} className="text-[12.5px] text-ink-muted hover:text-ink">
                取消
              </button>
            </div>
          )}
        </div>
      ))}

      {/* 新增父模块 */}
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line-soft pt-3">
        <input
          value={addName}
          onChange={(e) => setAddName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void addParent();
          }}
          placeholder="新模块名称(整体),回车添加"
          className={`${inputCls} max-w-[240px]`}
        />
        <button
          type="button"
          onClick={() => void addParent()}
          disabled={busy || !addName.trim()}
          className="rounded-md border border-line px-3 py-1.5 text-[13px] text-ink-2 transition hover:border-accent hover:text-accent disabled:opacity-50"
        >
          添加模块
        </button>
      </div>
      {msg && <p className="m-0 mt-2 text-[12.5px] text-t3">{msg}</p>}
    </section>
  );
}
