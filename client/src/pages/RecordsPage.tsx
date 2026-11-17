import { useState } from "react";
import { Link } from "react-router-dom";
import { Listbox, ListboxButton, ListboxOption, ListboxOptions } from "@headlessui/react";
import {
  CalendarDaysIcon,
  Squares2X2Icon,
  ChevronUpDownIcon,
  CheckIcon,
} from "@heroicons/react/24/outline";
import { api, useAsync } from "../api";
import { useProjects } from "../projects";
import { PageHead } from "../components/Layout";
import { Metabox, Placeholder } from "../components/Metabox";
import { TypePills, TypeTag } from "../components/Tags";
import { Pagination } from "../components/Pagination";
import type { DaySummary } from "../types";

type ViewMode = "timeline" | "cards";

interface TimelineDayGroup {
  date: string;
  weekday: string;
  totalEntries: number;
  items: DaySummary[];
}

export function RecordsPage() {
  const { projects } = useProjects();
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    return (localStorage.getItem("worknote_records_view") as ViewMode) || "timeline";
  });
  const [projectFilter, setProjectFilter] = useState<string>("all");
  const [monthFilter, setMonthFilter] = useState<string>("all");

  const [timelineOffset, setTimelineOffset] = useState(0);
  const [cardsOffset, setCardsOffset] = useState(0);

  const TIMELINE_PAGE_SIZE = 5; // 每天包含多个项目与条目表格，一屏 5 天最舒适
  const CARDS_PAGE_SIZE = 12; // 网格卡片每页 12 篇

  const { data, loading, error } = useAsync(() => api.records(0, 1000), []);

  if (error) return <Placeholder kind="error" text={`加载失败:${error}`} />;
  if (!data) return <Placeholder kind="loading" text="加载中..." />;

  const allItems = data.items;

  // 项目目录包含尚无记录的项目，历史记录中的项目也保留。
  const projectList = Array.from(new Set([...projects.map((p) => p.name), ...allItems.map((i) => i.projectName)])).filter(Boolean);
  const monthList = Array.from(new Set(allItems.map((i) => i.date.slice(0, 7)))).filter(Boolean);

  // 基础过滤
  const filteredItems = allItems.filter((i) => {
    const matchProj = projectFilter === "all" || i.projectName === projectFilter;
    const matchMonth = monthFilter === "all" || i.date.startsWith(monthFilter);
    return matchProj && matchMonth;
  });

  // 按自然日期聚合（用于时间轴视图）
  const timelineGroups: TimelineDayGroup[] = [];
  for (const item of filteredItems) {
    let grp = timelineGroups.find((g) => g.date === item.date);
    if (!grp) {
      grp = {
        date: item.date,
        weekday: item.weekday,
        totalEntries: 0,
        items: [],
      };
      timelineGroups.push(grp);
    }
    grp.totalEntries += item.entryCount;
    grp.items.push(item);
  }

  // 汇总总条目数及类型统计
  const totalEntries = filteredItems.reduce((acc, i) => acc + i.entryCount, 0);
  const totalTypeCounts: Record<string, number> = {};
  for (const it of filteredItems) {
    for (const [k, v] of Object.entries(it.counts)) {
      totalTypeCounts[k] = (totalTypeCounts[k] ?? 0) + v;
    }
  }

  // 切换视图并记住偏好
  function handleViewModeChange(mode: ViewMode) {
    setViewMode(mode);
    localStorage.setItem("worknote_records_view", mode);
  }

  function handleProjectChange(val: string) {
    setProjectFilter(val);
    setTimelineOffset(0);
    setCardsOffset(0);
  }

  function handleMonthChange(val: string) {
    setMonthFilter(val);
    setTimelineOffset(0);
    setCardsOffset(0);
  }

  function handleReset() {
    setProjectFilter("all");
    setMonthFilter("all");
    setTimelineOffset(0);
    setCardsOffset(0);
  }

  const projectOptions = [
    { value: "all", label: "全部项目" },
    ...projectList.map((p) => ({ value: p, label: p })),
  ];
  const currentProject = projectOptions.find((o) => o.value === projectFilter) ?? projectOptions[0];

  const monthOptions = [
    { value: "all", label: "全部月份" },
    ...monthList.map((m) => ({ value: m, label: m })),
  ];
  const currentMonth = monthOptions.find((o) => o.value === monthFilter) ?? monthOptions[0];

  // 分页切片安全 offset
  const safeTimelineOffset =
    timelineOffset >= timelineGroups.length && timelineGroups.length > 0
      ? Math.floor((timelineGroups.length - 1) / TIMELINE_PAGE_SIZE) * TIMELINE_PAGE_SIZE
      : timelineOffset;
  const pagedTimeline = timelineGroups.slice(
    safeTimelineOffset,
    safeTimelineOffset + TIMELINE_PAGE_SIZE,
  );

  const safeCardsOffset =
    cardsOffset >= filteredItems.length && filteredItems.length > 0
      ? Math.floor((filteredItems.length - 1) / CARDS_PAGE_SIZE) * CARDS_PAGE_SIZE
      : cardsOffset;
  const pagedCards = filteredItems.slice(safeCardsOffset, safeCardsOffset + CARDS_PAGE_SIZE);

  return (
    <>
      <PageHead title="全部记录" subtitle="所有项目按日期归档的工作内容与时间线" />

      {/* 顶部统计: 订正口径为 篇 与 天 */}
      <Metabox
        items={[
          {
            label: "记录",
            value: (
              <>
                {filteredItems.length}
                <span className="ml-0.5 text-[12.5px] font-normal text-ink-muted">篇</span>
              </>
            ),
            sub: `项目单日归档${projectFilter !== "all" || monthFilter !== "all" ? " (筛选)" : ""}`,
          },
          {
            label: "工作日",
            value: (
              <>
                {timelineGroups.length}
                <span className="ml-0.5 text-[12.5px] font-normal text-ink-muted">天</span>
              </>
            ),
            sub: "自然工作日",
          },
          {
            label: "事项总数",
            value: (
              <>
                {totalEntries}
                <span className="ml-0.5 text-[12.5px] font-normal text-ink-muted">条</span>
              </>
            ),
            sub: <TypePills counts={totalTypeCounts} />,
          },
        ]}
      />

      {/* 工具栏: 视图切换分段器 + 筛选菜单 */}
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3.5">
        {/* 左侧: 视图切换分段控件 */}
        <div className="inline-flex rounded-lg border border-line bg-surface-2 p-0.5 text-[12.5px]">
          <button
            type="button"
            onClick={() => handleViewModeChange("timeline")}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1 font-medium transition ${
              viewMode === "timeline"
                ? "bg-surface text-ink shadow-sm"
                : "text-ink-muted hover:text-ink"
            }`}
          >
            <CalendarDaysIcon className="h-4 w-4" />
            时间轴视图
          </button>
          <button
            type="button"
            onClick={() => handleViewModeChange("cards")}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1 font-medium transition ${
              viewMode === "cards"
                ? "bg-surface text-ink shadow-sm"
                : "text-ink-muted hover:text-ink"
            }`}
          >
            <Squares2X2Icon className="h-4 w-4" />
            卡片视图
          </button>
        </div>

        {/* 右侧: 项目筛选 + 月份筛选 */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[12.5px] text-ink-muted">筛选</span>

          {/* 项目筛选 */}
          <Listbox value={projectFilter} onChange={handleProjectChange}>
            <div className="relative">
              <ListboxButton className="flex cursor-pointer items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-[3px] text-[12.5px] text-ink-2 transition hover:border-accent hover:text-accent">
                <span>{currentProject.label}</span>
                <ChevronUpDownIcon className="h-3.5 w-3.5 text-ink-muted" />
              </ListboxButton>
              <ListboxOptions className="absolute right-0 z-30 mt-1 w-44 rounded-md border border-line bg-surface py-1 shadow-lg focus:outline-none">
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

          {/* 月份筛选 */}
          <Listbox value={monthFilter} onChange={handleMonthChange}>
            <div className="relative">
              <ListboxButton className="flex cursor-pointer items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-[3px] text-[12.5px] text-ink-2 transition hover:border-accent hover:text-accent">
                <span>{currentMonth.label}</span>
                <ChevronUpDownIcon className="h-3.5 w-3.5 text-ink-muted" />
              </ListboxButton>
              <ListboxOptions className="absolute right-0 z-30 mt-1 w-36 rounded-md border border-line bg-surface py-1 shadow-lg focus:outline-none">
                {monthOptions.map((o) => (
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

          {(projectFilter !== "all" || monthFilter !== "all") && (
            <button
              type="button"
              onClick={handleReset}
              className="cursor-pointer border-none bg-transparent text-[12px] text-accent hover:underline"
            >
              重置
            </button>
          )}
        </div>
      </div>

      {/* 主展示区 */}
      {!filteredItems.length && !loading && (
        <div className="py-12">
          <Placeholder
            kind="empty"
            text={projectFilter !== "all" || monthFilter !== "all" ? "暂无符合条件的记录" : "暂无工作记录。添加项目后，可在收件箱记一笔，或通过记录 CLI 归档。"}
          />
        </div>
      )}

      {/* 视图一：时间轴视图（按自然工作日聚合） */}
      {viewMode === "timeline" && !!pagedTimeline.length && (
        <div className="mt-6 space-y-6">
          {pagedTimeline.map((day) => (
            <div
              key={day.date}
              className="rounded-card border border-line bg-surface p-5 shadow-sm transition-colors"
            >
              {/* 日期头部栏 */}
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line-soft pb-3">
                <div className="flex items-baseline gap-2.5">
                  <span className="text-[16px] font-semibold tracking-[-0.2px] text-ink">
                    {day.date}
                  </span>
                  <span className="text-[13px] text-ink-muted">星期{day.weekday}</span>
                  <span className="ml-2 rounded-full border border-line bg-surface-2 px-2 py-0.5 text-[11.5px] font-normal text-ink-muted">
                    {day.totalEntries} 条事项
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {day.items.map((it) => (
                    <span
                      key={it.slug}
                      className="rounded border border-line bg-surface-2 px-2 py-0.5 text-[12px] text-ink-2"
                    >
                      {it.projectName}
                    </span>
                  ))}
                </div>
              </div>

              {/* 该日期下各项目的工作内容 */}
              <div className="mt-4 space-y-4">
                {day.items.map((it) => (
                  <div
                    key={`${it.slug}-${day.date}`}
                    className="border-l-2 border-line-soft py-1 pl-4"
                  >
                    {/* 项目行头 */}
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Link
                          to={`/days/${it.slug}/${it.date}`}
                          className="text-[14.5px] font-semibold text-ink hover:text-accent"
                        >
                          {it.projectName}
                        </Link>
                        {it.system && (
                          <span className="rounded border border-line bg-surface px-1.5 py-px text-[11.5px] text-ink-muted">
                            {it.system}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3">
                        <TypePills counts={it.counts} />
                        <Link
                          to={`/days/${it.slug}/${it.date}`}
                          className="text-[12.5px] text-accent hover:underline"
                        >
                          查看单日完整记录 →
                        </Link>
                      </div>
                    </div>

                    {/* 单日概要 */}
                    {it.summary && (
                      <div className="my-2.5 rounded-sm border-l-2 border-accent bg-surface px-3 py-1.5 text-[12.5px] leading-[1.65] text-ink-muted">
                        {it.summary}
                      </div>
                    )}

                    {/* 事项明细表格 */}
                    {Boolean(it.entries?.length) && (
                      <div className="mt-3 divide-y divide-line-soft border-t border-line-soft">
                        {it.entries.map((e) => (
                          <div
                            key={e.anchor}
                            className="grid grid-cols-[46px_1fr_auto] items-baseline gap-3.5 py-2 first:pt-2.5 last:pb-0 max-sm:grid-cols-[40px_1fr]"
                          >
                            <div className="text-right text-[12px] tabular-nums text-ink-muted">
                              {e.time}
                            </div>
                            <div className="min-w-0">
                              <Link
                                to={`/days/${it.slug}/${it.date}#${e.anchor}`}
                                className="text-[13.5px] text-ink hover:text-accent"
                              >
                                {e.title}
                              </Link>
                              {e.module && (
                                <span className="ml-2 text-[12px] text-ink-muted">
                                  {e.module}
                                </span>
                              )}
                            </div>
                            <div className="whitespace-nowrap max-sm:col-start-2">
                              <TypeTag type={e.type} />
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}

          {/* 时间轴分页器 */}
          <Pagination
            offset={safeTimelineOffset}
            limit={TIMELINE_PAGE_SIZE}
            total={timelineGroups.length}
            onChange={setTimelineOffset}
          />
        </div>
      )}

      {/* 视图二：卡片视图（项目单篇归档网格） */}
      {viewMode === "cards" && !!pagedCards.length && (
        <div className="mt-6">
          <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4 max-sm:grid-cols-1">
            {pagedCards.map((d) => (
              <Link
                key={`${d.slug}-${d.date}`}
                to={`/days/${d.slug}/${d.date}`}
                className="group flex flex-col justify-between rounded-card border border-line bg-surface p-5 text-ink transition-all hover:border-accent hover:shadow-sm hover:no-underline"
              >
                <div>
                  <div className="mb-2 flex items-baseline justify-between gap-2">
                    <span className="text-[15px] font-semibold tabular-nums tracking-[-0.2px] text-ink group-hover:text-accent">
                      {d.date}
                    </span>
                    <span className="text-[12px] text-ink-muted">星期{d.weekday}</span>
                  </div>

                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="text-[13.5px] font-medium text-ink-2">{d.projectName}</span>
                    {d.system && (
                      <span className="max-w-[130px] truncate rounded border border-line bg-surface-2 px-1.5 py-px text-[11px] text-ink-muted">
                        {d.system}
                      </span>
                    )}
                  </div>

                  {d.summary ? (
                    <div className="mb-4 line-clamp-3 text-[12.5px] leading-[1.65] text-ink-muted">
                      {d.summary}
                    </div>
                  ) : (
                    <div className="mb-4 text-[12.5px] text-ink-muted/50 italic">
                      （未填写单日概要）
                    </div>
                  )}
                </div>

                <div className="border-t border-line-soft pt-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2 text-[12px] text-ink-muted">
                    <span>
                      <b className="font-semibold tabular-nums text-ink">{d.entryCount}</b> 条事项
                    </span>
                    <TypePills counts={d.counts} />
                  </div>
                </div>
              </Link>
            ))}
          </div>

          {/* 卡片分页器 */}
          <Pagination
            offset={safeCardsOffset}
            limit={CARDS_PAGE_SIZE}
            total={filteredItems.length}
            onChange={setCardsOffset}
          />
        </div>
      )}
    </>
  );
}
