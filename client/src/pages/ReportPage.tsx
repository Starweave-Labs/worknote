/**
 * 汇报页:按时间区间一键生成 Markdown 工作汇报(周报/月报)。
 *
 * 纯后端确定性聚合(项目逐日条目、完成待办、逾期重点),
 * 页面渲染 HTML 版并支持下载 .md / 复制 Markdown。
 */
import { useState } from "react";
import { api, useAsync } from "../api";
import { PageHead } from "../components/Layout";
import { Placeholder } from "../components/Metabox";

function fmt(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

type Preset = { key: string; label: string; range: () => [string, string] };

function presets(): Preset[] {
  const now = new Date();
  const day = now.getDay(); // 0=周日
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const thisMonday = new Date(now);
  thisMonday.setDate(now.getDate() + mondayOffset);
  const lastMonday = new Date(thisMonday);
  lastMonday.setDate(thisMonday.getDate() - 7);
  const lastSunday = new Date(thisMonday);
  lastSunday.setDate(thisMonday.getDate() - 1);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);
  return [
    { key: "this-week", label: "本周", range: () => [fmt(thisMonday), fmt(now)] },
    { key: "last-week", label: "上周", range: () => [fmt(lastMonday), fmt(lastSunday)] },
    { key: "this-month", label: "本月", range: () => [fmt(monthStart), fmt(now)] },
    { key: "last-month", label: "上月", range: () => [fmt(lastMonthStart), fmt(lastMonthEnd)] },
  ];
}

export function ReportPage() {
  const ps = presets();
  const [from, setFrom] = useState(ps[0].range()[0]);
  const [to, setTo] = useState(ps[0].range()[1]);
  const [range, setRange] = useState<[string, string] | null>(ps[0].range());
  const [copied, setCopied] = useState(false);

  const { data, loading, error } = useAsync(
    () => (range ? api.report(range[0], range[1]) : Promise.resolve(null)),
    [range?.[0], range?.[1]],
  );

  function applyPreset(p: Preset) {
    const [f, t] = p.range();
    setFrom(f);
    setTo(t);
    setRange([f, t]);
  }

  function applyCustom() {
    if (from && to && from <= to) setRange([from, to]);
  }

  function download() {
    if (!data) return;
    const blob = new Blob([data.markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `工作汇报_${data.from}_${data.to}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function copy() {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(data.markdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      window.alert("复制失败,请手动选择文本");
    }
  }

  return (
    <>
      <PageHead title="汇报" subtitle="按时间范围汇总各项目工作、完成待办与逾期重点,一键生成周报/月报" />

      <div className="mt-5 flex flex-wrap items-center gap-2">
        {ps.map((p) => {
          const [f, t] = p.range();
          const active = range?.[0] === f && range?.[1] === t;
          return (
            <button
              key={p.key}
              type="button"
              onClick={() => applyPreset(p)}
              className={`rounded-md border px-3.5 py-1.5 text-[13px] transition ${
                active
                  ? "border-accent bg-accent-tint font-medium text-accent"
                  : "border-line bg-surface text-ink-2 hover:border-accent hover:text-accent"
              }`}
            >
              {p.label}
            </button>
          );
        })}
        <span className="mx-1 text-line">|</span>
        <input
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          className="rounded-md border border-line bg-surface px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-accent"
        />
        <span className="text-[13px] text-ink-muted">至</span>
        <input
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          className="rounded-md border border-line bg-surface px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-accent"
        />
        <button
          type="button"
          onClick={applyCustom}
          className="rounded-md bg-accent px-3.5 py-1.5 text-[13px] text-white transition hover:bg-accent-hover"
        >
          生成
        </button>
      </div>

      {loading && <Placeholder kind="loading" text="生成汇报中..." />}
      {error && <Placeholder kind="error" text={`生成失败:${error}`} />}
      {data && !loading && (
        <>
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <span className="text-[13px] text-ink-muted">
              {data.stats.dayCount} 个工作日 · {data.stats.entryCount} 条事项 · 完成待办 {data.stats.doneCount} 条
            </span>
            <span className="flex-1" />
            <button
              type="button"
              onClick={copy}
              className="rounded-md border border-line bg-surface px-3 py-1.5 text-[13px] text-ink-2 transition hover:border-accent hover:text-accent"
            >
              {copied ? "已复制 ✓" : "复制 Markdown"}
            </button>
            <button
              type="button"
              onClick={download}
              className="rounded-md border border-line bg-surface px-3 py-1.5 text-[13px] text-ink-2 transition hover:border-accent hover:text-accent"
            >
              下载 .md
            </button>
          </div>

          <div
            className="report-body mt-3 max-w-[820px] rounded-md border border-line bg-surface px-5 py-4 text-ink"
            dangerouslySetInnerHTML={{ __html: data.html }}
          />
        </>
      )}
    </>
  );
}
