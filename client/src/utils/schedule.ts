/**
 * 排期共享工具:日历/甘特视图的日期计算、泳道分配与 chip 样式映射。
 * CalendarPage(可交互)与 SharePage(只读)共用;视觉语言为白底彩边线框 chip。
 */
import { TYPE_ORDER } from "../constants";

/** 排期视图所需的最小待办契约(TodoItem / ShareTodoItem 均结构满足)。 */
export interface SchedItem {
  name: string;
  progress: number;
  type: string;
  source: string;
  group?: string;
  start?: string;
  due?: string;
}

export const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];
export const MONTH_CN = ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"];

export const TYPE_BG = ["bg-t1", "bg-t2", "bg-t3", "bg-t4"];
/** chip 边框(完整类名字面量,Tailwind JIT 才能扫描生成;勿动态拼接)。 */
export const TYPE_CHIP = [
  "border-t1/60 hover:border-t1",
  "border-t2/60 hover:border-t2",
  "border-t3/60 hover:border-t3",
  "border-t4/60 hover:border-t4",
];

export const CELL_H = 126;
export const DATE_H = 24;
export const LANE_H = 24;
export const MAX_LANES = 4;
export const GUTTER = 220; // 甘特左侧列宽

export function fmt(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function parseDate(s: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function addDays(date: string, n: number): string {
  const d = parseDate(date)!;
  d.setDate(d.getDate() + n);
  return fmt(d);
}

export function dayDiff(a: string, b: string): number {
  return Math.round((parseDate(b)!.getTime() - parseDate(a)!.getTime()) / 86400_000);
}

export function typeBg(type: string): string {
  const i = TYPE_ORDER.indexOf(type as (typeof TYPE_ORDER)[number]);
  return TYPE_BG[i < 0 ? 0 : i];
}

export function typeChip(type: string): string {
  const i = TYPE_ORDER.indexOf(type as (typeof TYPE_ORDER)[number]);
  return TYPE_CHIP[i < 0 ? 0 : i];
}

export type Seg = { t: SchedItem; s: string; e: string };

/** 排期区间:start 缺省按 due 单点;无 due 进未排期池(不产出 seg)。 */
export function segOf(t: SchedItem): { s: string; e: string } | null {
  if (!t.due) return null;
  const s = t.start && t.start <= t.due ? t.start : t.due;
  return { s, e: t.due };
}

/** 每周行的泳道分配(贪心:放进第一条空闲泳道)。 */
export function assignLanes(
  bars: { id: string; s: string; e: string; col0: number; col1: number; t: SchedItem }[],
): { bars: { id: string; s: string; e: string; col0: number; col1: number; t: SchedItem; lane: number }[]; overflow: number } {
  const lanes: string[] = [];
  const out: { id: string; s: string; e: string; col0: number; col1: number; t: SchedItem; lane: number }[] = [];
  let overflow = 0;
  for (const b of [...bars].sort((a, x) => (a.s < x.s ? -1 : a.s > x.s ? 1 : x.e < a.e ? 1 : -1))) {
    let lane = lanes.findIndex((last) => last < b.s);
    if (lane < 0) {
      lane = lanes.length;
      lanes.push(b.e);
    } else {
      lanes[lane] = b.e;
    }
    if (lane < MAX_LANES) out.push({ ...b, lane });
    else overflow += 1;
  }
  return { bars: out, overflow };
}
