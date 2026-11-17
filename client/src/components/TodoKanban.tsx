import { useState } from "react";
import { Link } from "react-router-dom";
import {
  ChatBubbleLeftEllipsisIcon,
  PencilSquareIcon,
  TrashIcon,
  ArrowUturnLeftIcon,
} from "@heroicons/react/24/outline";
import { PriorityTag, TypeTag, DueTag } from "./Tags";
import { NoteText, splitDoneMark } from "./NoteText";
import { TYPE_ORDER } from "../constants";
import { TodoProgress } from "./TodoProgress";
import { todoKey } from "../utils/todo-state";

export interface KanbanItem {
  name: string;
  note: string;
  progress: number;
  priority?: string;
  start?: string;
  due?: string;
  type: string;
  group: string;
  source: string;
  sourceText: string;
  created?: boolean;
  completion?: { text: string; images?: { alt: string; src: string }[] };
  feedback?: { by: string; at: string; text: string; images?: { alt: string; src: string }[] }[];
}

export interface TodoKanbanProps {
  openItems: KanbanItem[];
  doneItems: KanbanItem[];
  onDetail: (item: KanbanItem, done: boolean) => void;
  onComplete?: (item: KanbanItem) => void;
  onUndone?: (item: KanbanItem) => void;
  onEdit?: (item: KanbanItem) => void;
  onDelete?: (item: KanbanItem) => void;
  onFeedback?: (item: KanbanItem) => void;
  /** 登录页提供进度保存;分享页不传,与 editable 完全独立。 */
  onProgressCommit?: (item: KanbanItem, progress: number) => Promise<void>;
  busyKeys?: ReadonlySet<string>;
  attachmentUrl: (src: string) => string;
  editable?: boolean;
  /** 是否强制按类型分列（例如单项目分享页） */
  forceGroupByType?: boolean;
  /** 处于处理中的条目键值（如取消完成中） */
  busyKey?: string | null;
}

const DOT = ["bg-t1", "bg-t2", "bg-t3", "bg-t4"];

function projectOfGroup(group: string): string {
  return group.split(" · ")[0]?.trim() || group;
}

function toSiteLink(src: string): string {
  const m = src.match(
    /projects\/([^/]+)\/daily\/(\d{4}-\d{2})\/(\d{4}-\d{2}-\d{2})\/\d{4}-\d{2}-\d{2}\.md(?:#(.*))?/,
  );
  if (m) return `/days/${m[1]}/${m[3]}${m[4] ? `#${m[4]}` : ""}`;
  return src || "#";
}

export function TodoKanban({
  openItems,
  doneItems,
  onDetail,
  onComplete,
  onUndone,
  onEdit,
  onDelete,
  onFeedback,
  onProgressCommit,
  busyKeys,
  attachmentUrl,
  editable = true,
  forceGroupByType = false,
  busyKey = null,
}: TodoKanbanProps) {
  const [groupBy, setGroupBy] = useState<"project" | "type">(() => {
    if (forceGroupByType) return "type";
    return (localStorage.getItem("worknote_kanban_groupby") as "project" | "type") || "project";
  });

  const [showDoneColumn, setShowDoneColumn] = useState(true);

  function handleGroupByChange(mode: "project" | "type") {
    setGroupBy(mode);
    try {
      localStorage.setItem("worknote_kanban_groupby", mode);
    } catch {}
  }

  // 1. 决定列结构
  interface Column {
    id: string;
    title: string;
    dot?: string;
    items: KanbanItem[];
    isDone?: boolean;
  }

  const columns: Column[] = [];

  if (groupBy === "type" || forceGroupByType) {
    // 按事项类型分列
    for (let i = 0; i < TYPE_ORDER.length; i++) {
      const t = TYPE_ORDER[i];
      columns.push({
        id: t,
        title: t,
        dot: DOT[i],
        items: openItems.filter((item) => item.type === t),
      });
    }
    // 未归入合法类型的未完成项放入“其他待办”
    const others = openItems.filter((item) => !TYPE_ORDER.includes(item.type as any));
    if (others.length > 0) {
      columns.push({
        id: "other",
        title: "其他类型",
        items: others,
      });
    }
  } else {
    // 按项目分列
    const projectNames = Array.from(
      new Set(openItems.map((item) => projectOfGroup(item.group)).filter(Boolean)),
    );
    for (const pName of projectNames) {
      columns.push({
        id: pName,
        title: pName,
        items: openItems.filter((item) => projectOfGroup(item.group) === pName),
      });
    }
  }

  // 追加“已完成”列
  if (showDoneColumn) {
    columns.push({
      id: "done",
      title: "已完成",
      items: doneItems,
      isDone: true,
    });
  }

  return (
    <div className="mt-5">
      {/* 看板顶控栏：分列切换与已完成列显隐 */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {!forceGroupByType && (
            <div className="inline-flex rounded-lg border border-line bg-surface-2 p-0.5 text-[12px]">
              <button
                type="button"
                onClick={() => handleGroupByChange("project")}
                className={`rounded-md px-2.5 py-1 font-medium transition ${
                  groupBy === "project"
                    ? "bg-surface text-ink shadow-sm"
                    : "text-ink-muted hover:text-ink"
                }`}
              >
                按项目分列
              </button>
              <button
                type="button"
                onClick={() => handleGroupByChange("type")}
                className={`rounded-md px-2.5 py-1 font-medium transition ${
                  groupBy === "type"
                    ? "bg-surface text-ink shadow-sm"
                    : "text-ink-muted hover:text-ink"
                }`}
              >
                按类型分列
              </button>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 text-[12px] text-ink-muted">
          <label className="flex cursor-pointer items-center gap-1.5 select-none hover:text-ink">
            <input
              type="checkbox"
              checked={showDoneColumn}
              onChange={(e) => setShowDoneColumn(e.target.checked)}
              className="rounded border-line text-accent focus:ring-0"
            />
            <span>显示已完成列 ({doneItems.length})</span>
          </label>
        </div>
      </div>

      {/* 看板横向多列容器 */}
      <div className="flex items-start gap-4 overflow-x-auto pb-6 pt-1">
        {columns.map((col) => (
          <div
            key={col.id}
            className={`flex max-h-[calc(100vh-250px)] w-[310px] flex-none flex-col rounded-xl border ${
              col.isDone
                ? "border-line bg-surface-2/40"
                : "border-line bg-surface-2/70"
            }`}
          >
            {/* 列头部 */}
            <div className="flex items-center justify-between border-b border-line px-3.5 py-2.5">
              <div className="flex items-center gap-2">
                {col.dot && <span className={`h-2 w-2 rounded-sm ${col.dot}`} />}
                <span className="text-[13.5px] font-semibold text-ink">{col.title}</span>
              </div>
              <span className="rounded-full border border-line bg-surface px-2 py-0.5 text-[11px] font-normal text-ink-muted">
                {col.items.length}
              </span>
            </div>

            {/* 列内卡片流 */}
            <div className="flex-1 space-y-2.5 overflow-y-auto p-2.5">
              {!col.items.length && (
                <div className="py-8 text-center text-[12px] text-ink-muted/70">暂无事项</div>
              )}

              {col.items.map((it) => {
                const isItemDone = Boolean(col.isDone);
                const key = todoKey(it);
                const itemBusy = busyKeys?.has(key) || busyKey === key;
                const { doneAt } = splitDoneMark(it.note);
                const { text: noteText } = splitDoneMark(it.note);
                const projName = projectOfGroup(it.group);

                return (
                  <div
                    key={key}
                    onClick={() => onDetail(it, isItemDone)}
                    className="group relative rounded-lg border border-line bg-surface p-3 shadow-2xs transition-all hover:border-accent hover:shadow-sm"
                  >
                    {/* 标签栏 */}
                    <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                      <DueTag due={it.due} done={isItemDone} />
                      <PriorityTag priority={it.priority} />
                      {groupBy !== "type" && <TypeTag type={it.type} />}
                      {groupBy !== "project" && projName && (
                        <span className="rounded border border-line bg-surface-2 px-1.5 py-px text-[11px] text-ink-muted">
                          {projName}
                        </span>
                      )}
                      {it.created && (
                        <span className="rounded border border-line bg-surface-2 px-1.5 py-px text-[10.5px] text-ink-muted">
                          新建
                        </span>
                      )}
                      {Boolean(it.feedback?.length) && (
                        <span
                          className="ml-auto inline-flex items-center rounded border border-accent/30 bg-accent-tint px-1.5 py-px text-[10.5px] font-medium text-accent"
                          title={`${it.feedback?.length ?? 0} 条反馈`}
                        >
                          反馈 ({it.feedback?.length ?? 0})
                        </span>
                      )}
                    </div>

                    {/* 事项标题 */}
                    <div
                      className={`text-[13.5px] leading-[1.45] font-semibold text-ink group-hover:text-accent ${
                        isItemDone ? "line-through text-ink-muted decoration-line" : ""
                      }`}
                    >
                      {it.name}
                    </div>

                    {/* 完成时间 */}
                    {isItemDone && doneAt && (
                      <div className="mt-1 text-[11.5px] text-ink-muted">完成时间: {doneAt}</div>
                    )}

                    {/* 待办说明（单行截断省略） */}
                    {noteText && (
                      <div
                        className="mt-1 truncate text-[12px] text-ink-muted"
                        title={noteText}
                      >
                        <NoteText text={noteText} imageUrl={attachmentUrl} />
                      </div>
                    )}

                    {/* 完成情况说明（单行截断） */}
                    {it.completion?.text && (
                      <div
                        className="mt-1 truncate text-[12px] text-ink-2"
                        title={it.completion.text}
                      >
                        完成情况: {it.completion.text}
                      </div>
                    )}

                    <TodoProgress
                      value={it.progress}
                      label={`${it.name}完成进度`}
                      className="mt-2"
                      readOnly={!onProgressCommit}
                      onCommit={onProgressCommit ? (progress) => onProgressCommit(it, progress) : undefined}
                      disabled={itemBusy}
                    />

                    {/* 底部条与快速操作 */}
                    <div
                      className="mt-2.5 flex items-center justify-between border-t border-line-soft pt-2 text-[11.5px] text-ink-muted"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {/* 来源或时间 */}
                      <div className="truncate pr-1">
                        {it.sourceText ? (
                          <Link
                            to={toSiteLink(it.source)}
                            className="text-ink-muted hover:text-accent hover:underline"
                          >
                            {it.sourceText}
                          </Link>
                        ) : (
                          <span>{it.created ? "站内创建" : ""}</span>
                        )}
                      </div>

                      {/* 交互按钮组 */}
                      <div className="flex flex-none items-center gap-1">
                        {/* 标记完成 / 取消完成 */}
                        {!isItemDone && editable && onComplete && (
                          <button
                            type="button"
                            title="标记完成"
                            onClick={() => onComplete(it)}
                            disabled={itemBusy}
                            className="flex h-5 items-center gap-1 rounded border border-line bg-surface px-1.5 text-[11px] text-ink-muted transition hover:border-accent hover:text-accent"
                          >
                            完成
                          </button>
                        )}

                        {isItemDone && onUndone && (
                          <button
                            type="button"
                            title="取消完成"
                            disabled={itemBusy}
                            onClick={() => onUndone(it)}
                            className="flex h-5 items-center gap-1 rounded border border-line bg-surface px-1.5 text-[11px] text-ink-muted transition hover:text-accent disabled:opacity-40"
                          >
                            <ArrowUturnLeftIcon className="h-3 w-3" />
                            撤销
                          </button>
                        )}

                        {/* 反馈入口 (在分享页可编辑时显式提供) */}
                        {editable && onFeedback && (
                          <button
                            type="button"
                            title="提交反馈"
                            onClick={() => onFeedback(it)}
                            className="flex h-5 items-center gap-0.5 rounded border border-line bg-surface px-1.5 text-[11px] text-ink-2 transition hover:border-accent hover:text-accent"
                          >
                            <ChatBubbleLeftEllipsisIcon className="h-3 w-3" />
                            反馈
                          </button>
                        )}

                        {/* 编辑 */}
                        {onEdit && (
                          <button
                            type="button"
                            title="编辑"
                            onClick={() => onEdit(it)}
                            disabled={itemBusy}
                            className="rounded p-1 text-ink-muted transition hover:text-accent"
                          >
                            <PencilSquareIcon className="h-3.5 w-3.5" />
                          </button>
                        )}

                        {/* 删除 */}
                        {onDelete && (
                          <button
                            type="button"
                            title="删除"
                            onClick={() => onDelete(it)}
                            disabled={itemBusy}
                            className="rounded p-1 text-ink-muted transition hover:text-t3"
                          >
                            <TrashIcon className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
