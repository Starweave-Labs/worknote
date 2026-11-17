import { Link } from "react-router-dom";
import { api, useAsync } from "../api";
import { PageHead } from "../components/Layout";
import { Metabox, Placeholder } from "../components/Metabox";
import { DistBar, TypePills, TypeTag } from "../components/Tags";
import { useAuth } from "../auth";
import { ProjectNotice } from "../projects";

export function OverviewPage() {
  const { authed } = useAuth();
  const { data, loading, error } = useAsync(() => api.overview(), [authed]);

  if (loading) return <Placeholder kind="loading" text="加载中..." />;
  if (error) return <Placeholder kind="error" text={`加载失败:${error}`} />;
  if (!data) return null;

  const latest = authed === true ? data.recentDays[0] : undefined;
  const earliestDate = data.projects.flatMap((p) => p.dateRange ?? []).filter(Boolean).sort()[0];

  return (
    <>
      <PageHead title="工作记录总览" subtitle="按项目(甲方/客户单位)划分,待办清单全库统一" />

      <Metabox
        items={[
          {
            label: "项目",
            value: data.projectCount,
            sub: data.projects.map((p) => p.name).join("、"),
          },
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
          {
            label: "未完成待办",
            value: (
              <>
                {data.todoOpen}
                <span className="ml-0.5 text-[12.5px] font-normal text-ink-muted">项</span>
              </>
            ),
            sub: `已完成 ${data.todoDone} 项`,
          },
          ...(latest
            ? [
                {
                  label: "最近记录",
                  value: latest.date,
                  sub: earliestDate ? `自 ${earliestDate} 起` : undefined,
                },
              ]
            : []),
        ]}
      />

      <div className="mb-0 mt-[18px]">
        <TypePills counts={data.counts} />
      </div>

      <div className="mt-2 grid grid-cols-[minmax(0,1fr)_330px] items-start gap-10 max-lg:grid-cols-1">
        {/* 左栏:最近记录时间线(需登录) */}
        <div className="min-w-0">
          {!data.authed || authed !== true ? (
            <>
              <h2 className="section-title">最近记录</h2>
              <div className="rounded-card border border-line bg-surface-2 px-5 py-4 text-[13.5px] text-ink-2">
                记录详情与待办清单需要登录后查看。
                <Link to="/login" className="ml-1 text-accent">
                  前往登录 →
                </Link>
              </div>
            </>
          ) : (
            <>
              <h2 className="section-title">最近记录</h2>
              {!data.recentDays.length && (
                <Placeholder kind="empty" text="暂无工作记录。添加项目后，可在收件箱记一笔，或通过记录 CLI 归档。" />
              )}
              <div>
                {data.recentDays.map((d) => (
                  <div key={`${d.slug}-${d.date}`} className="border-t border-line pt-4 first:border-t-0 first:pt-0">
                    <div className="mb-1 flex flex-wrap items-baseline gap-2.5">
                      <Link
                        to={`/days/${d.projectSlug}/${d.date}`}
                        className="text-[14px] font-semibold tabular-nums text-ink hover:text-accent"
                      >
                        {d.date}
                      </Link>
                      <span className="text-[12.5px] text-ink-muted">星期{d.weekday}</span>
                      <span className="ml-auto text-[12.5px] text-ink-muted">
                        {d.projectName} · {d.entryCount} 条
                      </span>
                    </div>
                    {d.entries.map((e) => (
                      <div
                        key={e.anchor}
                        className="grid grid-cols-[46px_1fr_auto] items-baseline gap-3.5 border-t border-line-soft py-[9px] first:border-t-0 max-sm:grid-cols-[40px_1fr] max-sm:gap-y-0.5"
                      >
                        <div className="text-right text-[12.5px] tabular-nums text-ink-muted">{e.time}</div>
                        <div className="flex min-w-0 items-baseline gap-2">
                          <Link to={`/days/${d.projectSlug}/${d.date}#${e.anchor}`} className="truncate text-ink hover:text-accent">
                            {e.title}
                          </Link>
                          {e.module && (
                            <span className="flex-none truncate text-[11.5px] text-ink-muted">· {e.module}</span>
                          )}
                        </div>
                        <div className="whitespace-nowrap max-sm:col-start-2">
                          <TypeTag type={e.type} />
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* 右栏:项目 + 类型分布 */}
        <aside className="min-w-0 lg:sticky lg:top-[72px]">
          <h2 className="section-title">项目</h2>
          {!data.projects.length && (data.authed
            ? <ProjectNotice />
            : <Placeholder kind="empty" text="暂无项目，请登录后查看初始化指引。" />)}
          <div className="grid gap-2.5">
            {data.projects.map((p) => (
              <Link
                key={p.slug}
                to={`/projects/${p.slug}`}
                className="group flex items-start gap-3 rounded-card border border-line bg-surface p-3.5 px-4 transition-all duration-150 hover:border-accent/40 hover:shadow-2xs hover:no-underline"
              >
                <div className="flex h-9 w-9 flex-none items-center justify-center rounded-md border border-line bg-accent-tint text-[15px] font-semibold text-accent">
                  {p.name[0]}
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="m-0 mb-0.5 text-[14.5px] font-semibold group-hover:text-accent-hover">
                    {p.name}
                  </h3>
                  <p className="m-0 truncate text-[12px] text-ink-muted">
                    {p.systems?.join(" · ") || "工作记录"}
                  </p>
                  <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2 text-[12px] text-ink-muted">
                    <span className="tabular-nums">{p.dayCount} 天</span>
                    <span className="text-line">·</span>
                    <span className="tabular-nums">{p.entryCount} 条</span>
                    <span className="ml-auto whitespace-nowrap text-accent">查看 →</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>

          <h2 className="section-title">类型分布</h2>
          <DistBar counts={data.counts} />
        </aside>
      </div>
    </>
  );
}
