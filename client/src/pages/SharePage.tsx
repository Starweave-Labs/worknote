import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Listbox, ListboxButton, ListboxOption, ListboxOptions } from "@headlessui/react";
import {
  ChevronUpDownIcon,
  CheckIcon,
  ChatBubbleLeftEllipsisIcon,
  ViewColumnsIcon,
  ListBulletIcon,
  CalendarDaysIcon,
  ChartBarIcon,
} from "@heroicons/react/24/outline";
import { api, useAsync } from "../api";
import { PageHead } from "../components/Layout";
import { Metabox, Placeholder } from "../components/Metabox";
import { TypeTag, PriorityTag, DueTag } from "../components/Tags";
import { TodoDetailDialog, type DetailItem } from "../components/TodoDetailDialog";
import { FeedbackDialog } from "../components/FeedbackDialog";
import { NoteText, splitDoneMark } from "../components/NoteText";
import { Pagination } from "../components/Pagination";
import { TodoKanban } from "../components/TodoKanban";
import { ScheduleBoard } from "../components/ScheduleBoard";
import { MONTH_CN, typeBg } from "../utils/schedule";
import { sortTodoItems, SORT_OPTIONS, type SortMode } from "../utils/todo-sort";
import type { SharePayload } from "../types";
import { TodoProgress } from "../components/TodoProgress";
import { applyTodoLists, sameTodo, todoKey } from "../utils/todo-state";

const PAGE_SIZE = 10;

/** 分享页:凭 token 免登录访问,展示该项目待办;mode=edit 时可勾选完成。 */
export function SharePage({ token }: { token: string }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const savingRef = useRef(new Set<string>());
  const tokenRef = useRef(token);
  tokenRef.current = token;
  const [savingKeys, setSavingKeys] = useState<ReadonlySet<string>>(new Set());
  const [writeError, setWriteError] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ item: DetailItem; done: boolean } | null>(null);
  const [fbFor, setFbFor] = useState<{ name: string; source: string } | null>(null);
  const [viewMode, setViewMode] = useState<"list" | "board" | "month" | "gantt">(() => {
    const v = searchParams.get("view");
    if (v === "list" || v === "board" || v === "month" || v === "gantt") return v;
    return (localStorage.getItem("worknote_share_view") as "list" | "board" | "month" | "gantt") || "board";
  });
  const [calCursor, setCalCursor] = useState(() => {
    const n = new Date();
    return { y: n.getFullYear(), m: n.getMonth() };
  });
  const [sortMode, setSortMode] = useState<SortMode>("time-desc");
  const [openOffset, setOpenOffset] = useState<number>(0);
  const [doneOffset, setDoneOffset] = useState<number>(0);
  const { data, loading, error, refetch, setData } = useAsync(() => api.share(token), [token]);

  useEffect(() => {
    savingRef.current.clear();
    setSavingKeys(new Set());
    setWriteError(null);
    setDetail(null);
    setFbFor(null);
  }, [token]);

  useEffect(() => {
    if (!data) return;
    setDetail((prev) => {
      if (!prev) return null;
      const open = data.todo.open.find((item) => sameTodo(item, prev.item));
      if (open) return { item: open, done: false };
      const done = data.todo.done.find((item) => sameTodo(item, prev.item));
      return done ? { item: done, done: true } : null;
    });
  }, [data]);

  if (loading || (data && data.token !== token && !error)) return <Placeholder kind="loading" text="加载中..." />;
  if (error && (!data || data.token !== token)) return <Placeholder kind="error" text={error} />;
  if (!data) return null;

  const p: SharePayload = data;
  const editable = p.mode === "edit";

  function handleViewModeChange(mode: "list" | "board" | "month" | "gantt") {
    setViewMode(mode);
    try {
      localStorage.setItem("worknote_share_view", mode);
    } catch {}
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (mode === "board") next.delete("view");
      else next.set("view", mode);
      return next;
    });
  }

  /** 分享页的图片走 token 附件路由(免登录)。 */
  const imageUrl = (src: string) => `/api/share/${encodeURIComponent(token)}/attachment/${src}`;

  async function toggle(item: { name: string; source: string }) {
    const key = todoKey(item);
    if (!editable || savingRef.current.has(key) || !p.todo.open.some((candidate) => sameTodo(candidate, item))) return;
    savingRef.current.add(key);
    setSavingKeys(new Set(savingRef.current));
    setWriteError(null);
    try {
      const result = await api.shareTodo(token, item.name, item.source);
      if (tokenRef.current !== token) return;
      if (!result.item || typeof result.done !== "boolean" || !result.previous) {
        throw new Error("服务端未返回待办快照，请刷新页面确认完成结果");
      }
      setData((prev) => prev && prev.token === token ? { ...prev, todo: applyTodoLists(prev.todo, result) } : prev);
      setDetail((prev) => prev && (sameTodo(prev.item, result.previous) || sameTodo(prev.item, result.item))
        ? { item: result.item, done: result.done }
        : prev);
    } catch (e) {
      if (tokenRef.current === token) setWriteError(`操作失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      if (tokenRef.current === token) {
        savingRef.current.delete(key);
        setSavingKeys(new Set(savingRef.current));
      }
    }
  }

  const openItems = p.todo.open;
  const doneItems = p.todo.done;

  const sortedOpen = sortTodoItems(openItems, sortMode, false);
  const sortedDone = sortTodoItems(doneItems, sortMode, true);

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

  function handleSortChange(val: SortMode) {
    setSortMode(val);
    setOpenOffset(0);
    setDoneOffset(0);
  }

  const currentSort = SORT_OPTIONS.find((o) => o.value === sortMode) ?? SORT_OPTIONS[0];

  return (
    <>
      <PageHead
        title={`${p.project.name} · 待办`}
        subtitle={
          editable
            ? `共享链接 · 可勾选完成、提交反馈${p.feedbackBy ? `（反馈方：${p.feedbackBy}）` : ""}`
            : "共享链接 · 仅可查看"
        }
      />

      <Metabox
        items={[
          {
            label: "未完成",
            value: (
              <>
                {openItems.length}
                <span className="ml-0.5 text-[12.5px] font-normal text-ink-muted">项</span>
              </>
            ),
            sub: "待处理事项",
          },
          {
            label: "已完成",
            value: (
              <>
                {doneItems.length}
                <span className="ml-0.5 text-[12.5px] font-normal text-ink-muted">项</span>
              </>
            ),
            sub: "历史留痕",
          },
          { label: "系统", value: "\u00a0", sub: p.project.systems.join(" · ") || "—" },
        ]}
      />

      {(writeError || error) && <p role="alert" className="mt-4 text-[12.5px] text-accent">{writeError || `列表刷新失败：${error}`}</p>}

      {/* 模块与验收(只读,随分享展示) */}
      {p.modules.length > 0 && (
        <section className="mt-5 rounded-xl border border-line bg-surface px-5 py-4">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="m-0 text-[15px] font-semibold">模块与验收</h2>
            <span className="text-[12px] text-ink-muted">验收进度</span>
          </div>
          {p.modules.map((m) => (
            <div key={m.name} className="border-t border-line-soft py-2.5 first:border-t-0">
              <div className="flex flex-wrap items-center gap-2.5">
              <span className="text-[13.5px] font-semibold text-ink">{m.name}</span>
              <span
                className={`rounded-full px-2 py-0.5 text-[11.5px] ${
                  m.status === "已验收"
                    ? "bg-t1 text-white"
                    : m.status === "待验收"
                      ? "bg-t2/15 text-t2"
                      : m.status === "进行中"
                        ? "bg-accent-tint text-accent"
                        : "bg-line-soft text-ink-muted"
                }`}
              >
                {m.status}
              </span>
              <span className="min-w-[120px] flex-1">
                <span className="block h-1.5 overflow-hidden rounded-full bg-line-soft">
                  <span className="block h-full rounded-full bg-t2" style={{ width: `${m.progress}%` }} />
                </span>
              </span>
              <span className="w-9 text-right text-[12px] tabular-nums text-ink-muted">{m.progress}%</span>
              {m.note && (
                <span className="max-w-[260px] truncate text-[12px] text-ink-muted" title={m.note}>
                  {m.note}
                </span>
              )}
              </div>
              {m.subs.map((sub) => (
                <div key={sub.name} className="mt-1.5 flex flex-wrap items-center gap-2.5 pl-7">
                  <span className="text-[13px] text-ink-2">
                    <span className="mr-1 text-ink-muted">└</span>
                    {sub.name}
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11.5px] ${
                      sub.status === "已验收"
                        ? "bg-t1 text-white"
                        : sub.status === "待验收"
                          ? "bg-t2/15 text-t2"
                          : sub.status === "进行中"
                            ? "bg-accent-tint text-accent"
                            : "bg-line-soft text-ink-muted"
                    }`}
                  >
                    {sub.status}
                  </span>
                  <span className="min-w-[100px] flex-1">
                    <span className="block h-1.5 overflow-hidden rounded-full bg-line-soft">
                      <span className="block h-full rounded-full bg-t2" style={{ width: `${sub.progress}%` }} />
                    </span>
                  </span>
                  <span className="w-9 text-right text-[12px] tabular-nums text-ink-muted">{sub.progress}%</span>
                  {sub.note && (
                    <span className="max-w-[220px] truncate text-[12px] text-ink-muted" title={sub.note}>
                      {sub.note}
                    </span>
                  )}
                </div>
              ))}
            </div>
          ))}
        </section>
      )}

      {/* 视图模式切换与排序控制条 */}
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="inline-flex rounded-lg border border-line bg-surface-2 p-0.5 text-[12px]">
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
              onClick={() => handleViewModeChange("month")}
              className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 font-medium transition ${
                viewMode === "month" ? "bg-surface text-ink shadow-sm" : "text-ink-muted hover:text-ink"
              }`}
            >
              <CalendarDaysIcon className="h-4 w-4" />
              日历
            </button>
            <button
              type="button"
              onClick={() => handleViewModeChange("gantt")}
              className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 font-medium transition ${
                viewMode === "gantt" ? "bg-surface text-ink shadow-sm" : "text-ink-muted hover:text-ink"
              }`}
            >
              <ChartBarIcon className="h-4 w-4" />
              甘特
            </button>
          </div>

          <span className="text-[12.5px] text-ink-muted">排序</span>
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
        </div>
      </div>

      {/* 排期视图: 日历 / 甘特(只读,与站内 ScheduleBoard 同一渲染) */}
      {(viewMode === "month" || viewMode === "gantt") && (
        <div className="mt-5">
          {viewMode === "month" && (
            <div className="mb-3 flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => setCalCursor((c) => {
                  const d = new Date(c.y, c.m - 1, 1);
                  return { y: d.getFullYear(), m: d.getMonth() };
                })}
                aria-label="上个月"
                className="rounded-md border border-line px-2.5 py-1.5 text-[13px] text-ink-2 transition hover:border-accent hover:text-accent"
              >
                ‹
              </button>
              <span className="min-w-[96px] text-center text-[14px] font-medium tabular-nums">
                {calCursor.y} 年 {MONTH_CN[calCursor.m]}
              </span>
              <button
                type="button"
                onClick={() => setCalCursor((c) => {
                  const d = new Date(c.y, c.m + 1, 1);
                  return { y: d.getFullYear(), m: d.getMonth() };
                })}
                aria-label="下个月"
                className="rounded-md border border-line px-2.5 py-1.5 text-[13px] text-ink-2 transition hover:border-accent hover:text-accent"
              >
                ›
              </button>
              <span className="ml-1 hidden items-center gap-2.5 sm:flex">
                {["待排查", "需求", "修改", "优化"].map((t) => (
                  <span key={t} className="flex items-center gap-1.5 text-[12px] text-ink-muted">
                    <span className={`h-2 w-2 rounded-sm ${typeBg(t)}`} />
                    {t}
                  </span>
                ))}
              </span>
            </div>
          )}
          <ScheduleBoard
            view={viewMode}
            items={openItems}
            cursor={calCursor}
            onEdit={(t) => {
              const it = openItems.find((x) => sameTodo(x, t));
              if (it) setDetail({ item: it as DetailItem, done: false });
            }}
          />
        </div>
      )}

      {/* 主展示区: 看板视图 或 双栏列表视图 */}
      {(viewMode === "board" || viewMode === "list") && (viewMode === "board" ? (
        <TodoKanban
          openItems={sortedOpen}
          doneItems={sortedDone}
          onDetail={(it, done) => setDetail({ item: it as DetailItem, done })}
          onComplete={editable ? (it) => toggle(it) : undefined}
          onFeedback={editable ? (it) => setFbFor({ name: it.name, source: it.source }) : undefined}
          attachmentUrl={imageUrl}
          editable={editable}
          forceGroupByType={p.project.slug !== "_all"}
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
              <span className="text-[12px] text-ink-muted">{currentSort.label}</span>
            </div>

            {!sortedOpen.length && (
              <div className="py-8">
                <Placeholder kind="empty" text="暂无未完成事项" />
              </div>
            )}

            <ul className="m-0 list-none p-0">
              {pagedOpen.map((it) => {
                const key = todoKey(it);
                const itemBusy = savingKeys.has(key);
                return (
                  <li
                    key={key}
                    className="flex gap-3 border-b border-line-soft py-3.5 last:border-b-0"
                  >
                    {editable ? (
                      <button
                        type="button"
                        aria-label="标记完成"
                        disabled={itemBusy}
                        onClick={() => toggle(it)}
                        className="mt-1 h-[15px] w-[15px] flex-none rounded border-[1.5px] border-line transition hover:border-accent disabled:opacity-50"
                      />
                    ) : (
                      <span className="mt-1 h-[15px] w-[15px] flex-none rounded border-[1.5px] border-line" />
                    )}
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
                        </div>
                        {(() => {
                          const { text } = splitDoneMark(it.note);
                          return (
                            text && (
                              <div
                                className="mt-0.5 truncate text-[12.5px] text-ink-muted"
                                title={text}
                              >
                                <NoteText text={text} imageUrl={imageUrl} />
                              </div>
                            )
                          );
                        })()}
                        {it.completion?.text && (
                          <div
                            className="mt-0.5 truncate text-[12.5px] text-ink-2"
                            title={it.completion.text}
                          >
                            完成情况:{it.completion.text}
                          </div>
                        )}
                      </button>
                      <TodoProgress value={it.progress} label={`${it.name}完成进度`} readOnly className="mt-2" />
                      {editable && (
                        <button
                          type="button"
                          onClick={() => setFbFor({ name: it.name, source: it.source })}
                          className="mt-1.5 inline-flex items-center gap-1 rounded-md border border-line bg-surface px-2 py-0.5 text-[12px] text-ink-2 transition hover:border-accent hover:text-accent"
                        >
                          <ChatBubbleLeftEllipsisIcon className="h-3.5 w-3.5" />
                          反馈{it.feedback?.length ? ` (${it.feedback.length})` : ""}
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>

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
              {pagedDone.map((it) => {
                const key = todoKey(it);
                return (
                  <li key={key} className="flex gap-3 border-b border-line-soft py-3.5 last:border-b-0">
                    <span className="mt-1 flex h-[15px] w-[15px] flex-none items-center justify-center rounded border-[1.5px] border-ink-muted bg-ink-muted text-[11px] leading-none text-surface">
                      ✓
                    </span>
                    <div className="min-w-0 flex-1">
                      <button
                        type="button"
                        onClick={() => setDetail({ item: it, done: true })}
                        className="block w-full max-w-full cursor-pointer border-none bg-transparent p-0 text-left"
                      >
                        <div className="text-[14.5px] text-ink-muted line-through decoration-line">
                          {it.name}
                          {it.priority && (
                            <span className="ml-1.5 inline-flex items-center no-underline">
                              <PriorityTag priority={it.priority} />
                            </span>
                          )}
                        </div>
                        {(() => {
                          const { doneAt } = splitDoneMark(it.note);
                          return (
                            doneAt && (
                              <div className="mt-0.5 text-[12.5px] text-ink-muted">完成时间:{doneAt}</div>
                            )
                          );
                        })()}
                        {(() => {
                          const { text } = splitDoneMark(it.note);
                          return (
                            text && (
                              <div
                                className="mt-0.5 truncate text-[12.5px] text-ink-muted"
                                title={text}
                              >
                                <NoteText text={text} imageUrl={imageUrl} />
                              </div>
                            )
                          );
                        })()}
                        {it.completion?.text && (
                          <div
                            className="mt-0.5 truncate text-[12.5px] text-ink-2"
                            title={it.completion.text}
                          >
                            完成情况:{it.completion.text}
                          </div>
                        )}
                      </button>
                      <TodoProgress value={it.progress} label={`${it.name}完成进度`} readOnly className="mt-2" />
                      {editable && (
                        <button
                          type="button"
                          onClick={() => setFbFor({ name: it.name, source: it.source })}
                          className="mt-1.5 inline-flex items-center gap-1 rounded-md border border-line bg-surface px-2 py-0.5 text-[12px] text-ink-2 transition hover:border-accent hover:text-accent"
                        >
                          <ChatBubbleLeftEllipsisIcon className="h-3.5 w-3.5" />
                          反馈{it.feedback?.length ? ` (${it.feedback.length})` : ""}
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>

            <Pagination
              offset={safeDoneOffset}
              limit={PAGE_SIZE}
              total={sortedDone.length}
              onChange={setDoneOffset}
            />
          </section>
        </div>
      ))}

      <p className="mt-8 border-t border-line pt-5 text-[12.5px] text-ink-muted">
        这是由 WorkNote 生成的分享链接{editable ? "（可勾选完成、提交反馈）" : "（仅可查看）"}。完成进度仅供查看，点待办可查看详情。
      </p>

      {detail && (
        <TodoDetailDialog
          item={detail.item}
          done={detail.done}
          imageUrl={imageUrl}
          onClose={() => setDetail(null)}
        />
      )}

      {fbFor && (
        <FeedbackDialog
          token={token}
          itemName={fbFor.name}
          source={fbFor.source}
          feedbackBy={p.feedbackBy}
          onClose={() => setFbFor(null)}
          onSubmitted={() => void refetch()}
        />
      )}
    </>
  );
}