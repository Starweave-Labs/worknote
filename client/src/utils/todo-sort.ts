import { splitDoneMark } from "../components/NoteText";

export type SortMode = "time-desc" | "time-asc" | "priority" | "due";

export const SORT_OPTIONS: { value: SortMode; label: string }[] = [
  { value: "time-desc", label: "时间倒序 (最新)" },
  { value: "time-asc", label: "时间正序 (最早)" },
  { value: "priority", label: "优先级排序" },
  { value: "due", label: "按预计完成" },
];

const PRI_WEIGHT: Record<string, number> = { 高: 3, 中: 2, 低: 1 };

export interface BaseTodoItem {
  name: string;
  note: string;
  priority?: string;
  due?: string;
  source?: string;
  sourceText?: string;
}

/** 规范化时间戳为「YYYY-MM-DD HH:MM」，便于字符串逐字比对。 */
export function normalizeTime(raw: string): string {
  if (!raw) return "";
  const s = raw.trim();
  const m = s.match(/(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}))?/);
  if (!m) return "";
  const date = m[1];
  const time = m[2] || "00:00";
  return `${date} ${time}`;
}

/**
 * 提取条目的来源时间戳（从 sourceText 或 source 路径与锚点解析）。
 */
export function getItemSourceTime(it: BaseTodoItem): string {
  if (it.sourceText) {
    const norm = normalizeTime(it.sourceText);
    if (norm) return norm;
  }
  if (it.source) {
    // 匹配例如 projects/.../daily/2026-10/2026-10-15/2026-10-15.md#18-27-...
    const m = it.source.match(/\/(\d{4}-\d{2}-\d{2})\/\d{4}-\d{2}-\d{2}\.md(?:#(\d{2})[-:](\d{2}))?/);
    if (m) {
      const date = m[1];
      const time = m[2] && m[3] ? `${m[2]}:${m[3]}` : "00:00";
      return `${date} ${time}`;
    }
  }
  return "";
}

/**
 * 提取条目的关键时间：
 * - 已完成事项：优先取完成标记时间戳，若无则回退到来源时间；
 * - 未完成事项：取来源时间。
 */
export function getItemTime(it: BaseTodoItem, isDone: boolean): string {
  if (isDone) {
    const { doneAt } = splitDoneMark(it.note);
    if (doneAt) {
      const norm = normalizeTime(doneAt);
      if (norm) return norm;
    }
  }
  return getItemSourceTime(it);
}

/**
 * 对待办事项数组进行稳定排序。
 * 默认排序模式为 time-desc（最新优先）。
 */
export function sortTodoItems<T extends BaseTodoItem>(
  items: T[],
  mode: SortMode = "time-desc",
  isDone: boolean = false,
): T[] {
  const list = [...items];

  list.sort((a, b) => {
    const timeA = getItemTime(a, isDone);
    const timeB = getItemTime(b, isDone);
    const priA = PRI_WEIGHT[a.priority || ""] || 0;
    const priB = PRI_WEIGHT[b.priority || ""] || 0;

    if (mode === "due") {
      // 预计完成升序(最近截止在前,逾期天然置顶) > 无 due 排最后 > 优先级降序
      const dueA = a.due || "";
      const dueB = b.due || "";
      if (dueA && dueB && dueA !== dueB) return dueA.localeCompare(dueB);
      if (dueA && !dueB) return -1;
      if (!dueA && dueB) return 1;
      return priB - priA;
    }

    if (mode === "priority") {
      // 优先级降序 > 时间倒序
      if (priB !== priA) return priB - priA;
      if (timeA && timeB && timeA !== timeB) return timeB.localeCompare(timeA);
      if (timeA && !timeB) return -1;
      if (!timeA && timeB) return 1;
      return 0;
    }

    if (mode === "time-asc") {
      // 时间正序（最早优先） > 优先级降序
      if (timeA && timeB && timeA !== timeB) return timeA.localeCompare(timeB);
      if (timeA && !timeB) return -1;
      if (!timeA && timeB) return 1;
      return priB - priA;
    }

    // 默认 time-desc: 时间倒序（最新优先） > 优先级降序
    if (timeA && timeB && timeA !== timeB) return timeB.localeCompare(timeA);
    if (timeA && !timeB) return -1;
    if (!timeA && timeB) return 1;
    return priB - priA;
  });

  return list;
}
