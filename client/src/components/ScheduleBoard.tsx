/**
 * 排期板:月历(跨天线框 chip) + 甘特图(全交互/只读双模)。
 *
 * CalendarPage(登录,interactive=true)与 SharePage(免登录,只读)共用:
 *  - 月历:每周行绝对定位覆盖层渲染跨格 chip(贪心泳道),今天 accent 实心圆;
 *  - 甘特:项目分组、双层刻度(月份+周)、今日实线;interactive 时条形可拖身平移/
 *    拖两端把手改跨度(hover 条形即现把手),点击回调 onEdit;
 *  - 只读模式不挂任何拖拽监听,光标样式退化为 pointer。
 * 视觉:白底彩边线框 chip + hover shadow-2xs→sm(全站 TodoKanban 语言)。
 */
import { useCallback, useRef, useState } from "react";
import {
  WEEKDAYS,
  CELL_H,
  DATE_H,
  LANE_H,
  MAX_LANES,
  GUTTER,
  fmt,
  parseDate,
  addDays,
  dayDiff,
  typeBg,
  typeChip,
  segOf,
  assignLanes,
  type SchedItem,
  type Seg,
} from "../utils/schedule";

type DragMode = "move" | "resize-start" | "resize-end";
interface DragState {
  id: string;
  t: SchedItem;
  mode: DragMode;
  origStart: string;
  origEnd: string;
  grabX: number;
  dayPx: number;
  delta: number;
  moved: boolean;
}

export interface ScheduleBoardProps {
  view: "month" | "gantt";
  /** 开放待办(未排期项不出现在板上)。 */
  items: SchedItem[];
  /** 月历月份游标(受控)。 */
  cursor: { y: number; m: number };
  /** 拖拽交互(默认只读)。 */
  interactive?: boolean;
  /** 拖拽落库回调(interactive 时必传)。 */
  onCommit?: (t: SchedItem, start: string, due: string) => Promise<void> | void;
  /** 点击条目/泳道项回调。 */
  onEdit?: (t: SchedItem) => void;
  /** 月历日期格 HTML5 drop 回调(未排期池拖入;不传则格子不接收 drop)。 */
  onCellDrop?: (due: string, e: React.DragEvent) => void;
}

export function ScheduleBoard({ view, items, cursor, interactive, onCommit, onEdit, onCellDrop }: ScheduleBoardProps) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const [hoverDate, setHoverDate] = useState<string | null>(null);
  const [floatPos, setFloatPos] = useState<{ x: number; y: number } | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);

  const today = fmt(new Date());
  const segs: Seg[] = items
    .map((t) => ({ t, seg: segOf(t) }))
    .filter((x): x is { t: SchedItem; seg: { s: string; e: string } } => !!x.seg)
    .map((x) => ({ t: x.t, s: x.seg.s, e: x.seg.e }));

  const commitSeg = useCallback(
    async (t: SchedItem, start: string, due: string) => {
      if (onCommit) await onCommit(t, start, due);
    },
    [onCommit],
  );

  /** 开始拖拽:监听器在 mousedown 当帧同步挂到 window,消除 effect 重渲染窗口期的漏接竞态。 */
  function startDrag(e: React.MouseEvent, t: SchedItem, modeD: DragMode, dayPx: number) {
    if (!interactive) return;
    e.preventDefault();
    e.stopPropagation();
    const seg = segOf(t);
    if (!seg || !dayPx) return;
    let cur: DragState = {
      id: t.name + t.source,
      t,
      mode: modeD,
      origStart: seg.s,
      origEnd: seg.e,
      grabX: e.clientX,
      dayPx,
      delta: 0,
      moved: false,
    };
    setDrag(cur);
    setFloatPos({ x: e.clientX, y: e.clientY });

    let raf = 0;
    let latest: MouseEvent | null = null;
    const tick = () => {
      raf = 0;
      if (!latest) return;
      const dx = latest.clientX - cur.grabX;
      const delta = Math.round(dx / cur.dayPx);
      cur = { ...cur, delta, moved: cur.moved || Math.abs(dx) > 3 };
      setDrag(cur);
      setFloatPos({ x: latest.clientX, y: latest.clientY });
      if (cur.mode === "move") setHoverDate(addDays(cur.origStart, delta));
    };
    const onMove = (ev: MouseEvent) => {
      latest = ev;
      if (!raf) raf = requestAnimationFrame(tick);
    };
    const cleanup = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("keydown", onKey);
      if (raf) cancelAnimationFrame(raf);
      setDrag(null);
      setFloatPos(null);
      setHoverDate(null);
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") cleanup();
    };
    const onUp = () => {
      cleanup();
      if (!cur.moved) {
        onEdit?.(cur.t);
        return;
      }
      const { origStart, origEnd, delta, mode: m } = cur;
      let ns = origStart;
      let ne = origEnd;
      if (m === "move") {
        ns = addDays(origStart, delta);
        ne = addDays(origEnd, delta);
      } else if (m === "resize-start") {
        ns = addDays(origStart, delta);
        if (ns > ne) ns = ne;
      } else {
        ne = addDays(origEnd, delta);
        if (ne < ns) ne = ns;
      }
      if (ns !== origStart || ne !== origEnd) void commitSeg(cur.t, ns, ne);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("keydown", onKey);
  }

  /* ---------------- 月历数据 ---------------- */

  const cells: (string | null)[] = (() => {
    const first = new Date(cursor.y, cursor.m, 1);
    const offset = (first.getDay() + 6) % 7;
    const days: (string | null)[] = [];
    for (let i = 0; i < offset; i++) days.push(null);
    const last = new Date(cursor.y, cursor.m + 1, 0).getDate();
    for (let d = 1; d <= last; d++) days.push(fmt(new Date(cursor.y, cursor.m, d)));
    while (days.length % 7 !== 0) days.push(null);
    return days;
  })();

  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  /* ---------------- 甘特数据 ---------------- */

  let gantt: {
    min: string;
    span: number;
    pos: (d: string) => number;
    ticks: { label: string; left: number }[];
    monthTicks: { label: string; left: number; width: number }[];
    groupOrder: string[];
    byGroup: Map<string, { t: SchedItem; s: string; e: string }[]>;
  } | null = null;
  if (segs.length) {
    const minRaw = segs.reduce((m, x) => (x.s < m ? x.s : m), segs[0]!.s);
    const maxRaw = segs.reduce((m, x) => (x.e > m ? x.e : m), segs[0]!.e);
    const minD = parseDate(minRaw)!;
    minD.setDate(minD.getDate() - 3);
    const maxD = parseDate(maxRaw)!;
    maxD.setDate(maxD.getDate() + 7);
    const min = fmt(minD);
    const span = Math.max(14, dayDiff(min, fmt(maxD)));
    const pos = (d: string) => (dayDiff(min, d) / span) * 100;
    const ticks: { label: string; left: number }[] = [];
    for (let d = parseDate(min)!; d <= maxD; d.setDate(d.getDate() + 7)) {
      ticks.push({ label: `${d.getMonth() + 1}/${d.getDate()}`, left: pos(fmt(d)) });
    }
    const monthTicks: { label: string; left: number; width: number }[] = [];
    for (
      let cur = new Date(parseDate(min)!.getFullYear(), parseDate(min)!.getMonth(), 1);
      cur <= maxD;
      cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1)
    ) {
      const me = fmt(new Date(cur.getFullYear(), cur.getMonth() + 1, 0));
      const l = Math.max(0, pos(fmt(cur)));
      const r = Math.min(100, pos(me) + 100 / span);
      if (r > 0 && l < 100) {
        monthTicks.push({ label: `${cur.getMonth() + 1}月`, left: l, width: Math.max(0, r - l) });
      }
    }
    const groupOrder: string[] = [];
    const byGroup = new Map<string, { t: SchedItem; s: string; e: string }[]>();
    for (const x of [...segs].sort((a, b) => (a.s < b.s ? 1 : a.s > b.s ? -1 : 0))) {
      const g = x.t.group || "其他";
      if (!byGroup.has(g)) {
        byGroup.set(g, []);
        groupOrder.push(g);
      }
      byGroup.get(g)!.push(x);
    }
    gantt = { min, span, pos, ticks, monthTicks, groupOrder, byGroup };
  }

  const floatLabel = (() => {
    if (!drag) return null;
    const { origStart, origEnd, delta, mode: m } = drag;
    if (m === "move") return { title: "移动到", value: `${addDays(origStart, delta)} ~ ${addDays(origEnd, delta)}` };
    if (m === "resize-start") return { title: "开始改为", value: addDays(origStart, delta) };
    return { title: "完成改为", value: addDays(origEnd, delta) };
  })();

  const barCursor = interactive ? (drag ? "grabbing" : "grab") : "pointer";

  return (
    <div className={drag ? "select-none" : ""}>
      {view === "month" && (
        <div ref={gridRef} className="min-w-0 overflow-hidden rounded-card border border-line bg-surface">
          <div className="grid grid-cols-7 border-b border-line">
            {WEEKDAYS.map((w, i) => (
              <div key={w} className={`py-2 text-center text-[12px] font-medium text-ink-muted ${i >= 5 ? "bg-canvas/40" : ""}`}>
                周{w}
              </div>
            ))}
          </div>
          {weeks.map((week, wi) => {
            const weekDates = week.filter((d): d is string => !!d);
            const weekBars = weekDates.length
              ? segs
                  .filter((x) => x.s <= weekDates[weekDates.length - 1]! && x.e >= weekDates[0]!)
                  .map((x) => ({
                    id: x.t.name + x.t.source,
                    t: x.t,
                    s: x.s,
                    e: x.e,
                    col0: Math.max(0, dayDiff(weekDates[0]!, x.s)),
                    col1: Math.min(6, dayDiff(weekDates[0]!, x.e)),
                  }))
              : [];
            const { bars, overflow } = assignLanes(weekBars);
            return (
              <div key={wi} className="relative grid grid-cols-7 border-b border-line-soft last:border-b-0" style={{ height: CELL_H }}>
                {week.map((date, di) => {
                  const isToday = date === today;
                  const isWeekend = di >= 5;
                  return (
                    <div
                      key={date ?? `e${di}`}
                      onDragOver={onCellDrop ? (e) => e.preventDefault() : undefined}
                      onDrop={date && onCellDrop ? (e) => onCellDrop(date, e) : undefined}
                      className={`relative border-r border-line-soft last:border-r-0 ${isWeekend ? "bg-canvas/40" : ""} ${
                        date && hoverDate === date && drag ? "ring-2 ring-inset ring-accent bg-accent-tint/60" : ""
                      }`}
                    >
                      {date && (
                        <div className="px-2 pt-1.5">
                          {isToday ? (
                            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent text-[12px] font-semibold tabular-nums text-white">
                              {Number(date.slice(8))}
                            </span>
                          ) : (
                            <span className={`pl-1.5 text-[13px] tabular-nums ${date < today ? "text-ink-muted" : "text-ink-2"}`}>
                              {Number(date.slice(8))}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
                {/* chip 覆盖层 */}
                <div className="pointer-events-none absolute inset-0">
                  {bars.map((b) => {
                    const isDragging = drag?.id === b.id;
                    const left = (b.col0 / 7) * 100;
                    const width = ((b.col1 - b.col0 + 1) / 7) * 100;
                    return (
                      <button
                        key={b.id}
                        type="button"
                        title={`${b.t.name}\n完成进度：${b.t.progress}%\n${b.s} → ${b.e}${interactive ? "(拖动平移,点击编辑)" : ""}`}
                        onMouseDown={interactive ? (e) => {
                          const w = gridRef.current?.clientWidth ?? 0;
                          startDrag(e, b.t, "move", w / 7);
                        } : undefined}
                        onClick={!interactive ? () => onEdit?.(b.t) : undefined}
                        className={`pointer-events-auto absolute z-[1] flex items-center gap-1.5 rounded-md border bg-surface px-2 text-left transition-[border-color,opacity,box-shadow,transform] duration-150 hover:shadow-sm ${typeChip(b.t.type)} ${
                          isDragging ? "z-10 opacity-40" : ""
                        }`}
                        style={{
                          left: `calc(${left}% + 3px)`,
                          width: `calc(${width}% - 6px)`,
                          top: DATE_H + b.lane * LANE_H + 2,
                          height: 22,
                          touchAction: "none",
                          cursor: barCursor,
                          transform: isDragging && drag ? `translateX(${drag.delta * drag.dayPx}px)` : undefined,
                        }}
                      >
                        <span className={`h-1.5 w-1.5 flex-none rounded-full ${typeBg(b.t.type)}`} />
                        <span className="min-w-0 flex-1 truncate text-[11.5px] leading-[20px] text-ink-2">{b.t.name}</span>
                        <span className="flex-none text-[10.5px] tabular-nums text-ink-muted">{b.t.progress}%</span>
                      </button>
                    );
                  })}
                  {overflow > 0 && (
                    <div className="absolute left-2 text-[11px] text-ink-muted" style={{ top: DATE_H + MAX_LANES * LANE_H + 1 }}>
                      还有 {overflow} 条…
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {view === "gantt" && !gantt && (
        <div className="rounded-card border border-line bg-surface px-6 py-14 text-center">
          <p className="m-0 text-[14px] text-ink-2">还没有已排期的待办</p>
          <p className="mt-1.5 text-[12.5px] text-ink-muted">在月历里拖拽排期,或点击待办设置预计完成日期</p>
        </div>
      )}
      {view === "gantt" && gantt && (
        <div className="overflow-hidden rounded-card border border-line bg-surface">
          <div className="min-w-[880px]">
            {/* 双层刻度:月份层 */}
            <div className="flex border-b border-line-soft" style={{ paddingLeft: GUTTER }}>
              <div className="relative h-6 min-w-0 flex-1">
                {gantt.monthTicks.map((m, i) => (
                  <span key={i} className="absolute top-1.5 -translate-x-1/2 text-[11px] font-medium text-ink-muted" style={{ left: `${m.left + m.width / 2}%` }}>
                    {m.label}
                  </span>
                ))}
              </div>
            </div>
            {/* 周刻度层 */}
            <div className="flex h-7 border-b border-line-soft" style={{ paddingLeft: GUTTER }}>
              <div ref={trackRef} className="relative h-full min-w-0 flex-1">
                {gantt.ticks.map((tk, i) => (
                  <span key={i} className="absolute top-2 -translate-x-1/2 text-[10.5px] tabular-nums text-ink-muted" style={{ left: `${tk.left}%` }}>
                    {tk.label}
                  </span>
                ))}
                {gantt.pos(today) >= 0 && gantt.pos(today) <= 100 && (
                  <span className="absolute top-1 -translate-x-1/2 rounded bg-accent px-1.5 text-[10px] font-medium text-white" style={{ left: `${gantt.pos(today)}%` }}>
                    今天
                  </span>
                )}
              </div>
            </div>
            {/* 项目分组 */}
            {gantt.groupOrder.map((g) => (
              <div key={g}>
                <div className="flex items-baseline justify-between border-b border-line-soft bg-canvas/60 px-3 py-1.5 text-[11.5px] font-semibold text-ink-2">
                  {g}
                  <span className="font-normal tabular-nums text-ink-muted">{gantt!.byGroup.get(g)!.length}</span>
                </div>
                {gantt.byGroup.get(g)!.map((x, ri) => {
                  const id = x.t.name + x.t.source;
                  const isDragging = drag?.id === id;
                  const left = gantt!.pos(x.s);
                  const width = Math.max(0.5, gantt!.pos(x.e) - left);
                  const trackW = trackRef.current?.clientWidth ?? 640;
                  const dayPx = trackW / gantt!.span;
                  let pvLeft = left;
                  let pvWidth = width;
                  if (isDragging && drag) {
                    const dPct = (drag.delta / gantt!.span) * 100;
                    if (drag.mode === "move") pvLeft = left + dPct;
                    else if (drag.mode === "resize-start") {
                      pvLeft = Math.min(left + dPct, left + width);
                      pvWidth = width - (pvLeft - left);
                    } else {
                      pvWidth = Math.max(0.5, width + dPct);
                    }
                  }
                  return (
                    <div key={id} className={`flex h-[38px] items-center border-b border-line-soft transition-colors duration-150 hover:bg-accent-tint/40 ${ri % 2 ? "bg-canvas/30" : ""} ${isDragging ? "bg-accent-tint/50" : ""}`}>
                      <div className="flex w-[220px] flex-none items-center gap-2 border-r border-line-soft px-3 text-[12.5px] text-ink" title={`${x.t.name}\n完成进度：${x.t.progress}%`}>
                        <span className="min-w-0 flex-1 truncate">{x.t.name}</span>
                        <span className="flex-none text-[11px] tabular-nums text-ink-muted">{x.t.progress}%</span>
                      </div>
                      <div className="relative h-full min-w-0 flex-1">
                        {gantt!.pos(today) >= 0 && gantt!.pos(today) <= 100 && (
                          <div className="absolute inset-y-0 w-[1.5px] bg-accent/70" style={{ left: `${gantt!.pos(today)}%` }} />
                        )}
                        <div
                          onMouseDown={interactive ? (e) => startDrag(e, x.t, "move", dayPx) : undefined}
                          onClick={!interactive ? () => onEdit?.(x.t) : undefined}
                          title={`${x.t.name}\n完成进度：${x.t.progress}%\n${x.s} → ${x.e}${interactive ? "(拖动平移,点击编辑)" : ""}`}
                          className={`group absolute top-1/2 flex h-[22px] -translate-y-1/2 items-center gap-1.5 rounded-md border bg-surface px-2 transition-[border-color,box-shadow,opacity] duration-150 hover:shadow-sm ${typeChip(x.t.type)} ${isDragging ? "z-10 opacity-50" : "z-[1]"}`}
                          style={{
                            left: `${pvLeft}%`,
                            width: `${pvWidth}%`,
                            touchAction: "none",
                            cursor: barCursor,
                          }}
                        >
                          {/* 左右把手:hover 条形即显现(interactive 才渲染) */}
                          {interactive && (
                            <>
                              <span
                                onMouseDown={(e) => startDrag(e, x.t, "resize-start", dayPx)}
                                className="absolute -left-1 top-0 flex h-full w-[10px] items-center justify-center opacity-0 transition-opacity duration-150 group-hover:opacity-100 hover:opacity-100"
                                style={{ cursor: "ew-resize", touchAction: "none" }}
                                title="拖动调整开始"
                              >
                                <span className={`h-[14px] w-[2px] rounded-full ${typeBg(x.t.type)} opacity-60`} />
                              </span>
                              <span
                                onMouseDown={(e) => startDrag(e, x.t, "resize-end", dayPx)}
                                className="absolute -right-1 top-0 flex h-full w-[10px] items-center justify-center opacity-0 transition-opacity duration-150 group-hover:opacity-100 hover:opacity-100"
                                style={{ cursor: "ew-resize", touchAction: "none" }}
                                title="拖动调整完成"
                              >
                                <span className={`h-[14px] w-[2px] rounded-full ${typeBg(x.t.type)} opacity-60`} />
                              </span>
                            </>
                          )}
                          <span className={`h-1.5 w-1.5 flex-none rounded-full ${typeBg(x.t.type)}`} />
                          <span className="pointer-events-none hidden truncate text-[10.5px] tabular-nums text-ink-2 sm:inline">
                            {x.s.slice(5)} → {x.e.slice(5)}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 跟随光标的日期徽标(仅 interactive 拖拽中) */}
      {drag && floatPos && floatLabel && (
        <div
          className="pointer-events-none fixed z-[1200] rounded-md bg-ink px-2 py-1 text-[11.5px] text-white shadow-lg"
          style={{ left: floatPos.x + 14, top: floatPos.y - 12 }}
        >
          {floatLabel.title} {floatLabel.value}
        </div>
      )}
    </div>
  );
}
