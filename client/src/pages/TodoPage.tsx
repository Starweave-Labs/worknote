import { Listbox, ListboxButton, ListboxOption, ListboxOptions } from "@headlessui/react";
import { Link, useSearchParams } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import {
  ChevronUpDownIcon,
  CheckIcon,
  PlusIcon,
  SparklesIcon,
  ArrowUturnLeftIcon,
  PencilSquareIcon,
  TrashIcon,
  ViewColumnsIcon,
  ListBulletIcon,
  ShareIcon,
} from "@heroicons/react/24/outline";
import { api, useAsync } from "../api";
import { useProjects } from "../projects";
import { PageHead } from "../components/Layout";
import { Metabox, Placeholder } from "../components/Metabox";
import { TypePills, TypeTag, PriorityTag, DueTag } from "../components/Tags";
import { NewTodoDialog } from "../components/NewTodoDialog";
import { CompleteTodoDialog } from "../components/CompleteTodoDialog";
import { EditTodoDialog } from "../components/EditTodoDialog";
import { TodoDetailDialog, type DetailItem } from "../components/TodoDetailDialog";
import { NoteText, splitDoneMark } from "../components/NoteText";
import { Pagination } from "../components/Pagination";
import { TodoKanban } from "../components/TodoKanban";
import { ShareDialog } from "../components/ShareDialog";
import { sortTodoItems, SORT_OPTIONS, type SortMode } from "../utils/todo-sort";
import { TYPE_ORDER, PRIORITY_ORDER } from "../constants";
import { TodoProgress } from "../components/TodoProgress";
import { applyTodoMutation, sameTodo, todoKey } from "../utils/todo-state";
import type { TodoItem, TodoMutationResponse } from "../types";

const DOT = ["bg-t1", "bg-t2", "bg-t3", "bg-t4"];

/** 把 todo.md 的 .md 链接换成站点内路由(保留 #anchor 以便定位到具体条目)。 */
function toSiteLink(src: string): string {
  const m = src.match(
    /projects\/([^/]+)\/daily\/(\d{4}-\d{2})\/(\d{4}-\d{2}-\d{2})\/\d{4}-\d{2}-\d{2}\.md(?:#(.*))?/,
  );
  if (m) return `/days/${m[1]}/${m[3]}${m[4] ? `#${m[4]}` : ""}`;
  return src || "#";
}

/** 仓库相对路径 -> 登录态可访问的附件 URL。 */
function attachmentUrl(src: string): string {
  const m = src.match(/^projects\/([^/]+)\/daily\/\d{4}-\d{2}\/(\d{4}-\d{2}-\d{2})\/attachments\/(.+)$/);
  if (m) return `/attachments/${m[1]}/${m[2]}/${m[3]}`;
  return src;
}

/** 从「项目 · 系统」分组名取项目显示名，用于完成接口的归属校验。 */
function projectOfGroup(group: string): string {
  return group.split(" · ")[0]?.trim() ?? group;
}

export function TodoPage() {
  const { projects } = useProjects();
  const { data, loading, error, refetch, setData } = useAsync(() => api.todo(), []);
  const [searchParams, setSearchParams] = useSearchParams();
  const PAGE_SIZE = 10;

  const [viewMode, setViewMode] = useState<"list" | "board">(() => {
    const v = searchParams.get("view");
    if (v === "list" || v === "board") return v;
    return (localStorage.getItem("worknote_todo_view") as "list" | "board") || "list";
  });
  const [shareOpen, setShareOpen] = useState(false);
  const [filter, setFilter] = useState<string>("all");
  const [projectFilter, setProjectFilter] = useState<string>("all");
  const [priorityFilter, setPriorityFilter] = useState<string>("all");
  const [sortMode, setSortMode] = useState<SortMode>("time-desc");
  const [openOffset, setOpenOffset] = useState<number>(0);
  const [doneOffset, setDoneOffset] = useState<number>(0);
  const [newOpen, setNewOpen] = useState(false);
  const [completing, setCompleting] = useState<TodoItem | null>(null);
  const [editing, setEditing] = useState<TodoItem | null>(null);
  const [detail, setDetail] = useState<{ item: DetailItem; done: boolean } | null>(null);
  const savingRef = useRef(new Set<string>());
  const [savingKeys, setSavingKeys] = useState<ReadonlySet<string>>(new Set());
  const [notice, setNotice] = useState<string | null>(null);

  // 刷新和 mutation 快照更新都同步详情,不按名称单独匹配。
  useEffect(() => {
    if (!data) return;
    setDetail((prev) => {
      if (!prev) return null;
      const open = data.open.find((item) => sameTodo(item, prev.item));
      if (open) return { item: open, done: false };
      const done = data.done.find((item) => sameTodo(item, prev.item));
      return done ? { item: done, done: true } : null;
    });
  }, [data]);

  function applyMutation(result: TodoMutationResponse) {
    if (!result.item || typeof result.done !== "boolean" || !result.previous) {
      throw new Error("服务端未返回待办快照，请刷新页面确认保存结果");
    }
    setData((prev) => prev ? applyTodoMutation(prev, result) : prev);
    setDetail((prev) => prev && (sameTodo(prev.item, result.previous) || sameTodo(prev.item, result.item))
      ? { item: result.item, done: result.done }
      : prev);
  }

  /** 列表/看板/详情共用同一保存入口,同一身份同时只允许一次写入。 */
  async function saveProgress(item: { name: string; source?: string }, progress: number) {
    const key = todoKey(item);
    if (savingRef.current.has(key)) throw new Error("该待办正在保存，请稍后重试");
    savingRef.current.add(key);
    setSavingKeys(new Set(savingRef.current));
    setNotice(null);
    try {
      applyMutation(await api.updateTodo(item.name, item.source ?? "", { progress }));
    } catch (e) {
      setNotice(`进度保存失败：${e instanceof Error ? e.message : String(e)}`);
      throw e;
    } finally {
      savingRef.current.delete(key);
      setSavingKeys(new Set(savingRef.current));
    }
  }

  async function refreshAfterWrite() {
    const latest = await refetch();
    if (!latest) setNotice("写入已成功，但列表刷新失败，请稍后重新刷新；请勿重复提交。");
  }

  if (loading) return <Placeholder kind="loading" text="加载中..." />;
  if (error && !data) return <Placeholder kind="error" text={`加载失败:${error}`} />;
  if (!data) return null;

  const openAll = data.open;
  const doneAll = data.done;

  // 已登记的空项目同样可筛选，旧分组也继续保留。
  const projectList = Array.from(
    new Set([...projects.map((p) => p.name), ...[...openAll, ...doneAll].map((i) => projectOfGroup(i.group))].filter(Boolean)),
  );

  // 过滤未完成列表
  const openShown = openAll.filter((i) => {
    const matchType = filter === "all" || i.type === filter;
    const matchProj = projectFilter === "all" || projectOfGroup(i.group) === projectFilter;
    const matchPri = priorityFilter === "all" || (i.priority || "") === priorityFilter;
    return matchType && matchProj && matchPri;
  });

  // 过滤已完成列表
  const doneShown = doneAll.filter((i) => {
    const matchType = filter === "all" || i.type === filter;
    const matchProj = projectFilter === "all" || projectOfGroup(i.group) === projectFilter;
    const matchPri = priorityFilter === "all" || (i.priority || "") === priorityFilter;
    return matchType && matchProj && matchPri;
  });

  // 排序
  const sortedOpen = sortTodoItems(openShown, sortMode, false);
  const sortedDone = sortTodoItems(doneShown, sortMode, true);

  // 分页切片安全 offset
  const safeOpenOffset =
    openOffset >= sortedOpen.length && sortedOpen.length > 0
      ? Math.floor((sortedOpen.length - 1) / PAGE_SIZE) * PAGE_SIZE
      : openOffset;
  const safeDoneOffset =
    doneOffset >= sortedDone.length && sortedDone.length > 0
      ? Math.floor((sortedDone.length - 1) / PAGE_SIZE) * PAGE_SIZE
      : doneOffset;

  const pagedOpen = sortedOpen.slice(safeOpenOffset, safeOpenOffset + PAGE_SIZE);
  const pagedDone = sortedDone.slice(safeDoneOffset, safeDoneOffset + PAGE_SIZE);

  // 按项目分组当前页的未完成项
  const openGroups: { name: string; items: typeof pagedOpen }[] = [];
  for (const it of pagedOpen) {
    const g = it.group || "其他";
    let bucket = openGroups.find((x) => x.name === g);
    if (!bucket) {
      bucket = { name: g, items: [] };
      openGroups.push(bucket);
    }
    bucket.items.push(it);
  }

  function handleViewModeChange(mode: "list" | "board") {
    setViewMode(mode);
    try {
      localStorage.setItem("worknote_todo_view", mode);
    } catch {}
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (mode === "board") next.set("view", "board");
      else next.delete("view");
      return next;
    });
  }

  function handleFilterChange(val: string) {
    setFilter(val);
    setOpenOffset(0);
    setDoneOffset(0);
  }
  function handleProjectChange(val: string) {
    setProjectFilter(val);
    setOpenOffset(0);
    setDoneOffset(0);
  }
  function handlePriorityChange(val: string) {
    setPriorityFilter(val);
    setOpenOffset(0);
    setDoneOffset(0);
  }
  function handleSortChange(val: SortMode) {
    setSortMode(val);
    setOpenOffset(0);
    setDoneOffset(0);
  }
  function handleResetFilters() {
    setFilter("all");
    setProjectFilter("all");
    setPriorityFilter("all");
    setSortMode("time-desc");
    setOpenOffset(0);
    setDoneOffset(0);
  }

  const typeOptions = [
    { value: "all", label: "全部类型", count: openAll.length, dot: "" },
    ...TYPE_ORDER.filter((t) => data.counts[t]).map((t) => ({
      value: t,
      label: t,
      count: data.counts[t],
      dot: DOT[TYPE_ORDER.indexOf(t)],
    })),
  ];
  const currentType = typeOptions.find((o) => o.value === filter) ?? typeOptions[0];

  const projectOptions = [
    { value: "all", label: "全部项目" },
    ...projectList.map((p) => ({ value: p, label: p })),
  ];
  const currentProject = projectOptions.find((o) => o.value === projectFilter) ?? projectOptions[0];

  const priorityOptions = [
    { value: "all", label: "全部优先级" },
    ...PRIORITY_ORDER.map((p) => ({ value: p, label: `${p}优` })),
  ];
  const currentPriority = priorityOptions.find((o) => o.value === priorityFilter) ?? priorityOptions[0];

  const currentSort = SORT_OPTIONS.find((o) => o.value === sortMode) ?? SORT_OPTIONS[0];

  async function handleDelete(name: string, source: string) {
    if (savingRef.current.has(todoKey({ name, source }))) return;
    if (!window.confirm(`确定要彻底删除待办「${name}」吗？关联的完成情况与反馈也将一并删除。`)) {
      return;
    }
    try {
      await api.deleteTodo(name, source);
      setDetail((prev) => prev && sameTodo(prev.item, { name, source }) ? null : prev);
      await refreshAfterWrite();
    } catch (e) {
      alert("删除失败：" + (e instanceof Error ? e.message : String(e)));
    }
  }

  async function handleUndone(name: string, source: string) {
    const key = todoKey({ name, source });
    if (savingRef.current.has(key)) return;
    if (!window.confirm(`确定要将待办「${name}」取消完成，重新标记为未完成并将进度重置为 0% 吗？`)) {
      return;
    }
    savingRef.current.add(key);
    setSavingKeys(new Set(savingRef.current));
    try {
      applyMutation(await api.undoneTodo(name, source));
    } catch (e) {
      alert("操作失败：" + (e instanceof Error ? e.message : String(e)));
    } finally {
      savingRef.current.delete(key);
      setSavingKeys(new Set(savingRef.current));
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHead
          title="待办清单"
          subtitle="全库统一视图,由每日记录自动汇总(来源:todo.md)"
        />
        <div className="flex flex-none gap-2 pt-10">
          <button
            type="button"
            onClick={() => setShareOpen(true)}
            className="flex items-center gap-1.5 rounded-md border border-line bg-surface px-3 py-1.5 text-[13.5px] text-ink-2 transition hover:border-accent hover:text-accent"
          >
            <ShareIcon className="h-4 w-4" />
            分享待办/看板
          </button>
          <button
            type="button"
            onClick={() => setNewOpen(true)}
            className="flex items-center gap-1.5 rounded-md bg-accent px-3.5 py-1.5 text-[13.5px] text-white transition hover:bg-accent-hover"
          >
            <PlusIcon className="h-4 w-4" />
            新建待办
          </button>
        </div>
      </div>

      <Metabox
        items={[
          {
            label: "未完成",
            value: (
              <>
                {openAll.length}
                <span className="ml-0.5 text-[12.5px] font-normal text-ink-muted">项</span>
              </>
            ),
            sub: "待处理事项",
          },
          {
            label: "已完成",
            value: (
              <>
                {data.done.length}
                <span className="ml-0.5 text-[12.5px] font-normal text-ink-muted">项</span>
              </>
            ),
            sub: "历史留痕",
          },
          { label: "类型分布", value: "\u00a0", sub: <TypePills counts={data.counts} /> },
        ]}
      />

      {(notice || error) && <p role="alert" className="mt-4 text-[12.5px] text-accent">{notice || `列表刷新失败：${error}`}</p>}

      {/* 筛选条:类型筛选 + 优先级筛选 + 项目筛选 + 排序 */}
      <div className="mt-5 flex flex-wrap items-center gap-2.5">
        {/* 视图模式切换 */}
        <div className="inline-flex rounded-lg border border-line bg-surface-2 p-0.5 text-[12px]">
          <button
            type="button"
            onClick={() => handleViewModeChange("list")}
            className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 font-medium transition ${
              viewMode === "list"
                ? "bg-surface text-ink shadow-sm"
                : "text-ink-muted hover:text-ink"
            }`}
          >
            <ListBulletIcon className="h-4 w-4" />
            列表
          </button>
          <button
            type="button"
            onClick={() => handleViewModeChange("board")}
            className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 font-medium transition ${
              viewMode === "board"
                ? "bg-surface text-ink shadow-sm"
                : "text-ink-muted hover:text-ink"
            }`}
          >
            <ViewColumnsIcon className="h-4 w-4" />
            看板
          </button>
        </div>

        <span className="text-[12.5px] text-ink-muted">筛选</span>

        {/* 优先级筛选 */}
        <Listbox value={priorityFilter} onChange={handlePriorityChange}>
          <div className="relative">
            <ListboxButton className="flex cursor-pointer items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-[3px] text-[12.5px] text-ink-2 transition hover:border-accent hover:text-accent">
              <span>{currentPriority.label}</span>
              <ChevronUpDownIcon className="h-3.5 w-3.5 text-ink-muted" />
            </ListboxButton>
            <ListboxOptions className="absolute z-30 mt-1 w-36 rounded-md border border-line bg-surface py-1 shadow-lg focus:outline-none">
              {priorityOptions.map((o) => (
                <ListboxOption
                  key={o.value}
                  value={o.value}
                  className={({ active }) =>
                    `flex cursor-pointer items-center justify-between px-3 py-1.5 text-[13px] ${
                      active ? "bg-accent-tint text-accent" : "text-ink-2"
                    }`
                  }
                >
                  {({ selected }) => (
                    <>
                      <span>{o.label}</span>
                      {selected && <CheckIcon className="h-3.5 w-3.5 text-accent" />}
                    </>
                  )}
                </ListboxOption>
              ))}
            </ListboxOptions>
          </div>
        </Listbox>

        {/* 类型筛选 */}
        <Listbox value={filter} onChange={handleFilterChange}>
          <div className="relative">
            <ListboxButton className="flex cursor-pointer items-center gap-2 rounded-full border border-line bg-surface px-3 py-[3px] text-[12.5px] text-ink-2 transition hover:border-accent hover:text-accent">
              {currentType.dot && <span className={`h-1.5 w-1.5 rounded-sm ${currentType.dot}`} />}
              {currentType.label} {currentType.value !== "all" && currentType.count}
              <ChevronUpDownIcon className="h-3.5 w-3.5 text-ink-muted" />
            </ListboxButton>
            <ListboxOptions className="absolute z-30 mt-1 w-40 rounded-md border border-line bg-surface py-1 shadow-lg focus:outline-none">
              {typeOptions.map((o) => (
                <ListboxOption
                  key={o.value}
                  value={o.value}
                  className={({ active }) =>
                    `flex cursor-pointer items-center gap-2 px-3 py-1.5 text-[13px] ${
                      active ? "bg-accent-tint text-accent" : "text-ink-2"
                    }`
                  }
                >
                  {({ selected }) => (
                    <>
                      {o.dot ? (
                        <span className={`h-1.5 w-1.5 rounded-sm ${o.dot}`} />
                      ) : (
                        <span className="h-1.5 w-1.5" />
                      )}
                      <span className="flex-1">
                        {o.label} {o.value !== "all" && <span className="text-ink-muted">{o.count}</span>}
                      </span>
                      {selected && <CheckIcon className="h-3.5 w-3.5 text-accent" />}
                    </>
                  )}
                </ListboxOption>
              ))}
            </ListboxOptions>
          </div>
        </Listbox>

        {/* 项目筛选 */}
        <Listbox value={projectFilter} onChange={handleProjectChange}>
          <div className="relative">
            <ListboxButton className="flex cursor-pointer items-center gap-2 rounded-full border border-line bg-surface px-3 py-[3px] text-[12.5px] text-ink-2 transition hover:border-accent hover:text-accent">
              {currentProject.label}
              <ChevronUpDownIcon className="h-3.5 w-3.5 text-ink-muted" />
            </ListboxButton>
            <ListboxOptions className="absolute z-30 mt-1 w-48 rounded-md border border-line bg-surface py-1 shadow-lg focus:outline-none">
              {projectOptions.map((o) => (
                <ListboxOption
                  key={o.value}
                  value={o.value}
                  className={({ active }) =>
                    `flex cursor-pointer items-center justify-between px-3 py-1.5 text-[13px] ${
                      active ? "bg-accent-tint text-accent" : "text-ink-2"
                    }`
                  }
                >
                  {({ selected }) => (
                    <>
                      <span className="truncate">{o.label}</span>
                      {selected && <CheckIcon className="h-3.5 w-3.5 text-accent" />}
                    </>
                  )}
                </ListboxOption>
              ))}
            </ListboxOptions>
          </div>
        </Listbox>

        {/* 排序方式 */}
        <span className="ml-1 text-[12.5px] text-ink-muted">排序</span>
        <Listbox value={sortMode} onChange={handleSortChange}>
          <div className="relative">
            <ListboxButton className="flex cursor-pointer items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-[3px] text-[12.5px] text-ink-2 transition hover:border-accent hover:text-accent">
              <span>{currentSort.label}</span>
              <ChevronUpDownIcon className="h-3.5 w-3.5 text-ink-muted" />
            </ListboxButton>
            <ListboxOptions className="absolute z-30 mt-1 w-40 rounded-md border border-line bg-surface py-1 shadow-lg focus:outline-none">
              {SORT_OPTIONS.map((o) => (
                <ListboxOption
                  key={o.value}
                  value={o.value}
                  className={({ active }) =>
                    `flex cursor-pointer items-center justify-between px-3 py-1.5 text-[13px] ${
                      active ? "bg-accent-tint text-accent" : "text-ink-2"
                    }`
                  }
                >
                  {({ selected }) => (
                    <>
                      <span>{o.label}</span>
                      {selected && <CheckIcon className="h-3.5 w-3.5 text-accent" />}
                    </>
                  )}
                </ListboxOption>
              ))}
            </ListboxOptions>
          </div>
        </Listbox>

        {(filter !== "all" || projectFilter !== "all" || priorityFilter !== "all" || sortMode !== "time-desc") && (
          <button
            type="button"
            onClick={handleResetFilters}
            className="cursor-pointer border-none bg-transparent text-[12px] text-accent hover:underline"
          >
            重置筛选
          </button>
        )}
      </div>

      {/* 主展示区: 看板视图 或 双栏列表视图 */}
      {viewMode === "board" ? (
        <TodoKanban
          openItems={sortedOpen}
          doneItems={sortedDone}
          onDetail={(it, done) => setDetail({ item: it as DetailItem, done })}
          onComplete={(it) => setCompleting(it as TodoItem)}
          onUndone={(it) => handleUndone(it.name, it.source)}
          onEdit={(it) => setEditing(it as TodoItem)}
          onDelete={(it) => handleDelete(it.name, it.source)}
          attachmentUrl={attachmentUrl}
          onProgressCommit={saveProgress}
          busyKeys={savingKeys}
        />
      ) : (
        <div className="mt-6 grid grid-cols-1 items-start gap-8 lg:grid-cols-2">
          {/* 左栏: 未完成待办 */}
          <section className="min-w-0">
            <div className="flex items-baseline justify-between border-b border-line pb-2">
              <h2 className="m-0 text-[15px] font-semibold tracking-[-0.2px] text-ink">
                未完成
                <span className="ml-2 rounded-full border border-line bg-surface-2 px-2 py-0.5 text-[12px] font-normal text-ink-muted">
                  {sortedOpen.length}
                </span>
              </h2>
              <div className="flex items-center gap-2 text-[12px] text-ink-muted">
                {priorityFilter !== "all" && <span>{priorityFilter}优</span>}
                {filter !== "all" && <span>{filter}</span>}
                <span>{currentSort.label}</span>
              </div>
            </div>

            {!sortedOpen.length && (
              <div className="py-8">
                <Placeholder kind="empty" text="暂无未完成事项" />
              </div>
            )}

            {openGroups.map((g) => (
              <div key={g.name} className="mt-5 first:mt-3">
                <div className="mb-0.5 flex items-baseline gap-2.5 border-b border-line-soft pb-1.5 text-[13px] font-semibold text-ink-2">
                  <span>{g.name}</span>
                  <span className="ml-auto text-[12px] font-normal text-ink-muted">
                    {g.items.length} 项
                  </span>
                </div>
                <ul className="m-0 list-none p-0">
                  {g.items.map((it) => (
                    <li
                      key={todoKey(it)}
                      className="group flex gap-3 border-b border-line-soft py-3.5 last:border-b-0"
                    >
                      <button
                        type="button"
                        aria-label={`完成:${it.name}`}
                        title="标记完成"
                        onClick={() => setCompleting(it)}
                        disabled={savingKeys.has(todoKey(it))}
                        className="mt-1 h-[15px] w-[15px] flex-none rounded border-[1.5px] border-line transition hover:border-accent"
                      />
                      <div className="min-w-0 flex-1">
                        <button
                          type="button"
                          onClick={() => setDetail({ item: it, done: false })}
                          className="block w-full max-w-full cursor-pointer border-none bg-transparent p-0 text-left"
                        >
                          <div className="text-[14.5px]">
                            {it.name}
                            <span className="ml-1.5 inline-flex items-center gap-1">
                              <DueTag due={it.due} />
                              <PriorityTag priority={it.priority} />
                              <TypeTag type={it.type} />
                            </span>
                            {it.created && (
                              <span className="ml-1.5 rounded border border-line bg-surface-2 px-1.5 py-px text-[11px] text-ink-muted">
                                新建
                              </span>
                            )}
                            {Boolean(it.feedback?.length) && (
                              <span
                                className="ml-1.5 inline-flex items-center rounded border border-accent/30 bg-accent-tint px-1.5 py-px text-[11px] font-medium text-accent"
                                title={`${it.feedback.length} 条反馈`}
                              >
                                反馈 ({it.feedback.length})
                              </span>
                            )}
                          </div>
                        </button>
                        {(() => {
                          const { text } = splitDoneMark(it.note);
                          if (!text && !it.completion?.text && !it.source) return null;
                          return (
                            <div className="mt-1 flex items-baseline gap-2.5 text-[12px]">
                              <span
                                className="min-w-0 flex-1 cursor-pointer truncate leading-[1.65]"
                                title={`${text}${it.completion?.text ? `\n完成情况:${it.completion.text}` : ""}`}
                                onClick={() => setDetail({ item: it, done: false })}
                              >
                                {text && (
                                  <span className="text-ink-2">
                                    <NoteText text={text} imageUrl={attachmentUrl} />
                                  </span>
                                )}
                                {it.completion?.text && (
                                  <span className="text-ink-muted"> · 完成情况:{it.completion.text}</span>
                                )}
                              </span>
                              {it.source && (
                                <Link
                                  to={toSiteLink(it.source)}
                                  className="flex-none text-[11.5px] text-ink-muted underline decoration-line hover:text-accent hover:decoration-current"
                                >
                                  {it.sourceText}
                                </Link>
                              )}
                            </div>
                          );
                        })()}
                        <TodoProgress
                          value={it.progress}
                          label={`${it.name}完成进度`}
                          className="mt-1"
                          onCommit={(progress) => saveProgress(it, progress)}
                          disabled={savingKeys.has(todoKey(it))}
                        />
                      </div>
                      <div className="flex flex-none items-start gap-1 opacity-0 transition group-hover:opacity-100">
                        <button
                          type="button"
                          onClick={() => setEditing(it)}
                          disabled={savingKeys.has(todoKey(it))}
                          title="编辑待办"
                          className="rounded border border-line bg-surface p-1 text-ink-muted hover:border-accent hover:text-accent"
                        >
                          <PencilSquareIcon className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(it.name, it.source)}
                          disabled={savingKeys.has(todoKey(it))}
                          title="删除待办"
                          className="rounded border border-line bg-surface p-1 text-ink-muted hover:border-t3 hover:text-t3"
                        >
                          <TrashIcon className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ))}

            <Pagination
              offset={safeOpenOffset}
              limit={PAGE_SIZE}
              total={sortedOpen.length}
              onChange={setOpenOffset}
            />
          </section>

          {/* 右栏: 已完成事项 */}
          <section className="min-w-0">
            <div className="flex items-baseline justify-between border-b border-line pb-2">
              <h2 className="m-0 text-[15px] font-semibold tracking-[-0.2px] text-ink">
                已完成
                <span className="ml-2 rounded-full border border-line bg-surface-2 px-2 py-0.5 text-[12px] font-normal text-ink-muted">
                  {sortedDone.length}
                </span>
              </h2>
              <span className="text-[12.5px] text-ink-muted">历史留痕</span>
            </div>

            {!sortedDone.length && (
              <div className="py-8">
                <Placeholder kind="empty" text="暂无已完成事项" />
              </div>
            )}

            <ul className="m-0 list-none p-0">
              {pagedDone.map((it) => (
                <li
                  key={todoKey(it)}
                  className="group flex gap-3 border-b border-line-soft py-3.5 last:border-b-0"
                >
                  <button
                    type="button"
                    aria-label={`取消完成:${it.name}`}
                    title="点击取消完成(改回未完成)"
                    disabled={savingKeys.has(todoKey(it))}
                    onClick={() => handleUndone(it.name, it.source)}
                    className="mt-1 flex h-[15px] w-[15px] flex-none items-center justify-center rounded border-[1.5px] border-ink-muted bg-ink-muted text-[11px] leading-none text-surface transition hover:bg-transparent hover:text-ink-muted disabled:opacity-50"
                  >
                    ✓
                  </button>
                  <div className="min-w-0 flex-1">
                    <button
                      type="button"
                      onClick={() => setDetail({ item: it, done: true })}
                      className="block w-full max-w-full cursor-pointer border-none bg-transparent p-0 text-left"
                    >
                      <div className="text-[14.5px] text-ink-muted line-through decoration-line group-hover:text-ink">
                        {it.name}
                        <span className="ml-1.5 inline-flex items-center gap-1 no-underline">
                          <PriorityTag priority={it.priority} />
                          {projectFilter === "all" && it.group && (
                            <span className="rounded border border-line bg-surface-2 px-1.5 py-px text-[11px] font-normal text-ink-muted">
                              {projectOfGroup(it.group)}
                            </span>
                          )}
                        </span>
                        {Boolean(it.feedback?.length) && (
                          <span
                            className="ml-1.5 inline-flex items-center rounded border border-line bg-surface-2 px-1.5 py-px text-[11px] font-medium no-underline text-ink-muted"
                            title={`${it.feedback.length} 条反馈`}
                          >
                            反馈 ({it.feedback.length})
                          </span>
                        )}
                      </div>
                    </button>
                    {(() => {
                      const { text, doneAt } = splitDoneMark(it.note);
                      const meta = [
                        doneAt && `完成 ${doneAt}`,
                        text,
                        it.completion?.text && `完成情况:${it.completion.text}`,
                      ].filter(Boolean) as string[];
                      if (!meta.length && !it.source) return null;
                      return (
                        <div className="mt-1 flex items-baseline gap-2.5 text-[12px]">
                          <span
                            className="min-w-0 flex-1 cursor-pointer truncate text-ink-muted leading-[1.65]"
                            title={meta.join("\n")}
                            onClick={() => setDetail({ item: it, done: true })}
                          >
                            {meta.join(" · ")}
                          </span>
                          {it.source && (
                            <Link
                              to={toSiteLink(it.source)}
                              className="flex-none text-[11.5px] text-ink-muted underline decoration-line hover:text-accent hover:decoration-current"
                            >
                              {it.sourceText}
                            </Link>
                          )}
                        </div>
                      );
                    })()}
                    <TodoProgress
                      value={it.progress}
                      label={`${it.name}完成进度`}
                      className="mt-1"
                      onCommit={(progress) => saveProgress(it, progress)}
                      disabled={savingKeys.has(todoKey(it))}
                    />
                  </div>
                  <div className="flex flex-none items-start gap-1 opacity-0 transition group-hover:opacity-100">
                    <button
                      type="button"
                      onClick={() => handleUndone(it.name, it.source)}
                      disabled={savingKeys.has(todoKey(it))}
                      title="取消完成"
                      className="rounded border border-line bg-surface px-2 py-0.5 text-[12px] text-ink-muted transition hover:text-accent disabled:opacity-40"
                    >
                      <span className="inline-flex items-center gap-1">
                        <ArrowUturnLeftIcon className="h-3 w-3" />
                        取消完成
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditing(it)}
                      disabled={savingKeys.has(todoKey(it))}
                      title="编辑待办"
                      className="rounded border border-line bg-surface p-1 text-ink-muted hover:border-accent hover:text-accent"
                    >
                      <PencilSquareIcon className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(it.name, it.source)}
                      disabled={savingKeys.has(todoKey(it))}
                      title="删除待办"
                      className="rounded border border-line bg-surface p-1 text-ink-muted hover:border-t3 hover:text-t3"
                    >
                      <TrashIcon className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>

            <Pagination
              offset={safeDoneOffset}
              limit={PAGE_SIZE}
              total={sortedDone.length}
              onChange={setDoneOffset}
            />
          </section>
        </div>
      )}

      {newOpen && (
        <NewTodoDialog
          onClose={() => setNewOpen(false)}
          onCreated={() => void refreshAfterWrite()}
        />
      )}
      {completing && (
        <CompleteTodoDialog
          item={completing}
          project={projectOfGroup(completing.group)}
          onClose={() => setCompleting(null)}
          onCompleted={applyMutation}
        />
      )}
      {editing && (
        <EditTodoDialog
          item={editing}
          onClose={() => setEditing(null)}
          onUpdated={applyMutation}
        />
      )}
      {detail && (
        <TodoDetailDialog
          item={detail.item}
          done={detail.done}
          imageUrl={attachmentUrl}
          canReply
          canToggleDone
          onProgressCommit={(progress) => saveProgress(detail.item, progress)}
          busy={savingKeys.has(todoKey(detail.item))}
          onFeedbackReplied={() => void refreshAfterWrite()}
          onStartComplete={() => {
            const itemToComplete = data.open.find((x) => sameTodo(x, detail.item)) ?? {
              name: detail.item.name,
              note: detail.item.note,
              priority: detail.item.priority,
              start: detail.item.start,
              due: detail.item.due,
              progress: detail.item.progress,
              type: detail.item.type,
              group: detail.item.group,
              source: detail.item.source ?? "",
              sourceText: detail.item.sourceText ?? "",
              completion: detail.item.completion ?? { text: "", images: [] },
              feedback: detail.item.feedback ?? [],
              created: detail.item.created ?? false,
            };
            setDetail(null);
            setCompleting(itemToComplete);
          }}
          onUndone={() => {
            const name = detail.item.name;
            const source = detail.item.source ?? "";
            void handleUndone(name, source);
          }}
          onEdit={() => {
            const itemToEdit = data.open.find((x) => sameTodo(x, detail.item)) ??
              data.done.find((x) => sameTodo(x, detail.item)) ?? {
                name: detail.item.name,
                note: detail.item.note,
                priority: detail.item.priority,
                start: detail.item.start,
                due: detail.item.due,
                progress: detail.item.progress,
                type: detail.item.type,
                group: detail.item.group,
                source: detail.item.source ?? "",
                sourceText: detail.item.sourceText ?? "",
                completion: detail.item.completion ?? { text: "", images: [] },
                feedback: detail.item.feedback ?? [],
                created: detail.item.created ?? false,
              };
            setDetail(null);
            setEditing(itemToEdit);
          }}
          onDelete={() => {
            const name = detail.item.name;
            const source = detail.item.source ?? "";
            setDetail(null);
            handleDelete(name, source);
          }}
          onClose={() => setDetail(null)}
        />
      )}

      {shareOpen && (
        <ShareDialog
          project="_all"
          projectName="全库待办看板"
          onClose={() => setShareOpen(false)}
        />
      )}

      <p className="mt-8 flex items-center gap-1.5 text-[12.5px] text-ink-muted">
        <SparklesIcon className="h-3.5 w-3.5" />
        新建待办时可用 AI 从文字/图片自动整理;完成时可让 AI 梳理完成情况;已完成项可随时取消完成改回未完成。
      </p>
    </>
  );
}
