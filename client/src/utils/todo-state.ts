import type { ShareTodoItem, TodoItem, TodoMutationResponse, TodoResponse } from "../types";

type TodoIdentity = { name: string; source?: string };

/** 名称与来源共同标识待办;不依赖排序、分页或分组位置。 */
export function todoKey(item: TodoIdentity): string {
  return JSON.stringify([item.name, item.source ?? ""]);
}

export function sameTodo(a: TodoIdentity, b: TodoIdentity): boolean {
  return a.name === b.name && (a.source ?? "") === (b.source ?? "");
}

/** 登录/分享共用一份权威分区,不额外叠加本地完成状态。 */
export function applyTodoLists<T extends TodoItem | ShareTodoItem>(
  data: { open: T[]; done: T[] },
  mutation: { item: T; done: boolean; previous: TodoIdentity },
): { open: T[]; done: T[] } {
  const matches = (item: T) => sameTodo(item, mutation.previous) || sameTodo(item, mutation.item);
  const replace = (items: T[], include: boolean) => {
    let inserted = false;
    const next = items.flatMap((item) => {
      if (!matches(item)) return [item];
      if (!include || inserted) return [];
      inserted = true;
      return [mutation.item];
    });
    if (include && !inserted) next.push(mutation.item);
    return next;
  };
  return { open: replace(data.open, !mutation.done), done: replace(data.done, mutation.done) };
}

/** 以服务端返回条目更新原位置或移入对应状态区,保留完成/反馈子块快照。 */
export function applyTodoMutation(data: TodoResponse, mutation: TodoMutationResponse): TodoResponse {
  const { open, done } = applyTodoLists(data, mutation);
  const counts: Record<string, number> = {};
  for (const item of open) if (item.type) counts[item.type] = (counts[item.type] ?? 0) + 1;
  const groups = Array.from(new Set(open.map((item) => item.group || "其他")));
  return { ...data, open, done, counts, groups };
}
