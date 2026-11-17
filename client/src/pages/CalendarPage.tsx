/**
 * 日历排期页:月历(跨天线框 chip) + 甘特图(全交互)。
 *
 * 渲染与拖拽逻辑抽在 components/ScheduleBoard(与分享页共用);本页负责:
 * 工具条(视图切换/月份导航/图例/统计)、未排期池(HTML5 拖入写预计完成)、
 * 落库提示与编辑弹窗。
 */
import { useState } from "react";
import { api, useAsync } from "../api";
import { PageHead } from "../components/Layout";
import { Placeholder } from "../components/Metabox";
import { EditTodoDialog } from "../components/EditTodoDialog";
import { ScheduleBoard } from "../components/ScheduleBoard";
import { TYPE_ORDER } from "../constants";
import { MONTH_CN, typeBg, segOf, type SchedItem } from "../utils/schedule";
import type { TodoItem } from "../types";

export function CalendarPage() {
  const { data, loading, error, refetch } = useAsync(() => api.todo(), []);
  const [mode, setMode] = useState<"month" | "gantt">("month");
  const [cursor, setCursor] = useState(() => {
    const n = new Date();
    return { y: n.getFullYear(), m: n.getMonth() };
  });
  const [editing, setEditing] = useState<TodoItem | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const open = data?.open ?? [];
  const scheduled = open.filter((t) => segOf(t));
  const unscheduled = open.filter((t) => !t.due);

  async function commitSeg(t: SchedItem, start: string, due: string) {
    setMsg(null);
    try {
      const full = t as TodoItem;
      await api.updateTodo(full.name, full.source, { start, due });
      setMsg(`「${t.name.slice(0, 20)}」→ ${start} ~ ${due}`);
      await refetch();
    } catch (e) {
      setMsg(`排期失败:${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /** 未排期池 → 日期格(HTML5 拖入写预计完成)。 */
  function onCellDrop(due: string, e: React.DragEvent) {
    e.preventDefault();
    try {
      const payload = JSON.parse(e.dataTransfer.getData("text/plain")) as { name: string; source: string };
      const t = open.find((x) => x.name === payload.name && x.source === payload.source);
      if (t && t.due !== due) {
        void commitSeg(t, t.start && t.start <= due ? t.start : "", due);
      }
    } catch {
      /* 非拖拽负载忽略 */
    }
  }

  function shiftMonth(delta: number) {
    setCursor((c) => {
      const d = new Date(c.y, c.m + delta, 1);
      return { y: d.getFullYear(), m: d.getMonth() };
    });
  }

  const chipCls =
    "flex w-full items-center gap-1.5 rounded-md border border-line-soft bg-surface px-2 py-1 text-left text-[12px] leading-[1.5] text-ink-2 transition hover:border-accent hover:shadow-2xs cursor-grab";

  return (
    <>
      <PageHead
        title="日历排期"
        subtitle="拖动色条调整排期(甘特可拖两端改跨度);未排期池拖入日期即设定预计完成,点击任何条目编辑细节"
      />

      {/* 工具条 */}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-lg border border-line bg-surface-2 p-0.5 text-[12px]">
          <button
            type="button"
            onClick={() => setMode("month")}
            className={`rounded-md px-3.5 py-1.5 font-medium transition ${mode === "month" ? "bg-surface text-ink shadow-sm" : "text-ink-muted hover:text-ink"}`}
          >
            月历
          </button>
          <button
            type="button"
            onClick={() => setMode("gantt")}
            className={`rounded-md px-3.5 py-1.5 font-medium transition ${mode === "gantt" ? "bg-surface text-ink shadow-sm" : "text-ink-muted hover:text-ink"}`}
          >
            甘特图
          </button>
        </div>

        {mode === "month" && (
          <div className="flex items-center gap-1.5">
            <button type="button" onClick={() => shiftMonth(-1)} aria-label="上个月" className="rounded-md border border-line px-2.5 py-1.5 text-[13px] text-ink-2 transition hover:border-accent hover:text-accent">‹</button>
            <span className="min-w-[96px] text-center text-[14px] font-medium tabular-nums">
              {cursor.y} 年 {MONTH_CN[cursor.m]}
            </span>
            <button type="button" onClick={() => shiftMonth(1)} aria-label="下个月" className="rounded-md border border-line px-2.5 py-1.5 text-[13px] text-ink-2 transition hover:border-accent hover:text-accent">›</button>
            <button
              type="button"
              onClick={() => {
                const n = new Date();
                setCursor({ y: n.getFullYear(), m: n.getMonth() });
              }}
              className="ml-1 rounded-md border border-line px-2.5 py-1.5 text-[12.5px] text-ink-muted transition hover:border-accent hover:text-accent"
            >
              今天
            </button>
          </div>
        )}

        <span className="hidden items-center gap-2.5 lg:flex">
          {TYPE_ORDER.map((t) => (
            <span key={t} className="flex items-center gap-1.5 text-[12px] text-ink-muted">
              <span className={`h-2 w-2 rounded-sm ${typeBg(t)}`} />
              {t}
            </span>
          ))}
        </span>
        <span className="flex-1" />
        {msg && <span className="text-[12.5px] text-accent">{msg}</span>}
        <span className="flex items-center gap-1.5">
          <span className="rounded-full bg-accent-tint px-2.5 py-1 text-[12px] text-accent">已排期 {scheduled.length}</span>
          <span className="rounded-full bg-line-soft px-2.5 py-1 text-[12px] text-ink-muted">未排期 {unscheduled.length}</span>
        </span>
      </div>

      {loading && <Placeholder kind="loading" text="加载待办..." />}
      {error && <Placeholder kind="error" text={`加载失败:${error}`} />}

      {data && mode === "month" && (
        <div className="mt-4 flex gap-4">
          {/* 未排期池 */}
          <aside className="w-[236px] flex-none rounded-card border border-line bg-surface p-3">
            <h2 className="m-0 mb-2 text-[12.5px] font-semibold text-ink-muted">未排期 · 拖到日历或点击设置</h2>
            <div className="max-h-[600px] space-y-1.5 overflow-y-auto pr-0.5">
              {!unscheduled.length && (
                <p className="m-0 py-3 text-center text-[12.5px] text-ink-muted">
                  {open.length ? "全部已排期" : "暂无未完成待办"}
                </p>
              )}
              {unscheduled.map((t) => (
                <div
                  key={t.name + t.source}
                  draggable
                  onDragStart={(e) =>
                    e.dataTransfer.setData("text/plain", JSON.stringify({ name: t.name, source: t.source }))
                  }
                  onClick={() => setEditing(t)}
                  title={t.name}
                >
                  <span className={chipCls}>
                    <span className={`h-1.5 w-1.5 flex-none rounded-full ${typeBg(t.type)}`} />
                    <span className="truncate">{t.name}</span>
                  </span>
                </div>
              ))}
            </div>
          </aside>

          <div className="min-w-0 flex-1">
            <ScheduleBoard
              view="month"
              items={open}
              cursor={cursor}
              interactive
              onCommit={commitSeg}
              onEdit={(t) => setEditing(t as TodoItem)}
              onCellDrop={onCellDrop}
            />
          </div>
        </div>
      )}

      {data && mode === "gantt" && (
        <div className="mt-4">
          <ScheduleBoard
            view="gantt"
            items={open}
            cursor={cursor}
            interactive
            onCommit={commitSeg}
            onEdit={(t) => setEditing(t as TodoItem)}
          />
          {!!unscheduled.length && (
            <div className="mt-4 rounded-card border border-line bg-surface p-3">
              <h2 className="m-0 mb-2 text-[12.5px] font-semibold text-ink-muted">未排期({unscheduled.length})</h2>
              <div className="flex flex-wrap gap-1.5">
                {unscheduled.map((t) => (
                  <button key={t.name + t.source} type="button" onClick={() => setEditing(t)} className={`${chipCls} w-auto max-w-[230px]`} title={t.name}>
                    <span className={`h-1.5 w-1.5 flex-none rounded-full ${typeBg(t.type)}`} />
                    <span className="truncate">{t.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {editing && (
        <EditTodoDialog
          item={editing}
          onClose={() => setEditing(null)}
          onUpdated={() => {
            setEditing(null);
            void refetch();
          }}
        />
      )}
    </>
  );
}
