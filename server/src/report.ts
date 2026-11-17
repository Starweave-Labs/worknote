/**
 * 汇报生成:按日期区间把全库记录与待办汇总成 Markdown 工作汇报。
 *
 * 纯确定性聚合(不调 AI,不臆造):自然日数、条目数与类型分布、
 * 各项目逐日条目标题、区间内完成的待办、未完成重点(逾期/今日到期)。
 * 输出 markdown,由前端渲染与下载。
 */

import { join } from "node:path";
import { collect, parseTodo, TYPE_ORDER } from "./parser.js";

export interface ReportStats {
  from: string;
  to: string;
  /** 区间内自然日数(跨项目去重)。 */
  dayCount: number;
  entryCount: number;
  counts: Record<string, number>;
  doneCount: number;
  projects: { name: string; days: number; entries: number }[];
}

const WEEKDAY_CN = ["日", "一", "二", "三", "四", "五", "六"];

function weekdayOf(date: string): string {
  return WEEKDAY_CN[new Date(date + "T00:00:00").getDay()];
}

export function buildReport(root: string, from: string, to: string): { markdown: string; stats: ReportStats } {
  const projects = collect(root).map((p) => ({
    ...p,
    days: p.days.filter((d) => d.date >= from && d.date <= to),
  }));
  projects.sort((a, b) => {
    const bd = b.days[0]?.date ?? "";
    const ad = a.days[0]?.date ?? "";
    return ad < bd ? 1 : ad > bd ? -1 : 0;
  });

  const allDays = projects.flatMap((p) => p.days.map((d) => d.date));
  const dayCount = new Set(allDays).size;
  const allEntries = projects.flatMap((p) => p.days.flatMap((d) => d.entries));
  const counts: Record<string, number> = {};
  for (const e of allEntries) {
    if (e.type) counts[e.type] = (counts[e.type] ?? 0) + 1;
  }

  // 区间内完成的待办(行内完成标记日期落在区间)
  const { open, done } = parseTodo(join(root, "todo.md"));
  const doneInRange = done
    .map((t) => ({ t, at: t.note.match(/已于 (\d{4}-\d{2}-\d{2})/)?.[1] ?? "" }))
    .filter((x) => x.at && x.at >= from && x.at <= to)
    .sort((a, b) => (a.at < b.at ? 1 : -1));

  const today = new Date();
  const p2 = (n: number) => String(n).padStart(2, "0");
  const todayStr = `${today.getFullYear()}-${p2(today.getMonth() + 1)}-${p2(today.getDate())}`;
  const overdue = open.filter((t) => t.due && t.due < todayStr);
  const dueToday = open.filter((t) => t.due === todayStr);

  const md: string[] = [];
  md.push(`# 工作汇报(${from} ~ ${to})`, "");
  md.push("## 一、概览", "");
  const typeLine = TYPE_ORDER.filter((t) => counts[t]).map((t) => `${t} ${counts[t]}`).join(" / ");
  md.push(
    `- 工作日 ${dayCount} 天,共记录事项 ${allEntries.length} 条${typeLine ? `(${typeLine})` : ""}`,
    `- 期间完成待办 ${doneInRange.length} 条;截至目前未完成 ${open.length} 条${overdue.length ? `,其中已逾期 ${overdue.length} 条` : ""}`,
    "",
  );

  md.push("## 二、各项目工作", "");
  if (!projects.some((p) => p.days.length)) {
    md.push("(该区间内无记录)", "");
  }
  for (const p of projects) {
    if (!p.days.length) continue;
    md.push(`### ${p.name}`, "");
    for (const d of p.days) {
      md.push(`- **${d.date.slice(5)} 周${weekdayOf(d.date)}**:${d.entries.map((e) => e.title).join(";")}`);
    }
    md.push("");
  }

  if (doneInRange.length) {
    md.push("## 三、期间完成的待办", "");
    for (const x of doneInRange) {
      const brief = x.t.completion.text.trim().replace(/\s*\n\s*/g, " ");
      md.push(`- ${x.t.name}${brief ? ` —— ${brief.slice(0, 80)}` : ""}(完成于 ${x.at})`);
    }
    md.push("");
  }

  md.push("## 四、未完成事项重点", "");
  if (overdue.length) {
    md.push(`- **已逾期(${overdue.length} 条)**:`);
    for (const t of overdue.slice(0, 10)) md.push(`  - ${t.name}(逾期至 ${t.due}|${t.group})`);
  }
  if (dueToday.length) {
    md.push(`- **今日到期(${dueToday.length} 条)**:`);
    for (const t of dueToday.slice(0, 10)) md.push(`  - ${t.name}(${t.group})`);
  }
  if (!overdue.length && !dueToday.length) {
    md.push(`- 无逾期与今日到期事项;未完成共 ${open.length} 条,详见待办清单。`);
  }
  md.push("");

  const markdown = md.join("\n");
  const stats: ReportStats = {
    from,
    to,
    dayCount,
    entryCount: allEntries.length,
    counts,
    doneCount: doneInRange.length,
    projects: projects
      .filter((p) => p.days.length)
      .map((p) => ({ name: p.name, days: p.days.length, entries: p.days.reduce((s, d) => s + d.entries.length, 0) })),
  };
  return { markdown, stats };
}
