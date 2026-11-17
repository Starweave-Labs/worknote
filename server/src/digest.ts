/**
 * WorkNote 晨报 CLI —— 每日定时汇总 + Webhook 推送 + git 快照。
 *
 * 汇总内容:今日到期 / 已逾期 / 滞留超 14 天的待办、昨日新记录、昨日完成的待办、
 * 近一天新到的反馈、收件箱未整理条数;文本打印到 stdout,并在配置了
 * WORKNOTE_NOTIFY_WEBHOOK 时推送到飞书/通用 Webhook;随后做一次 git 快照提交
 * (本地版本化兜底,只 commit 不 push)。
 *
 * 用法:
 *   node dist/digest.js [--date YYYY-MM-DD] [--no-send] [--no-git] [--json]
 *
 * 由 systemd timer 每日 08:30 触发(worknote-digest.timer),也可手工执行。
 */

import { resolve } from "node:path";
import { dataRoot } from "./environment.js";
import { snapshotData } from "./data-snapshot.js";
import { collect, parseTodo, type TodoItem } from "./parser.js";
import { loadWorknoteEnv, sendNotify, notifyConfigured } from "./notify.js";
import { listInbox } from "./inbox.js";
import { readConfig } from "./site-config.js";

loadWorknoteEnv();

const ROOT = dataRoot();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const WEEKDAY_CN = ["日", "一", "二", "三", "四", "五", "六"];
/** 滞留阈值(站点设置可改,缺省 14 天)。 */
const STALE_DAYS = readConfig().staleDays ?? 14;

function today(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function dateAdd(date: string, days: number): string {
  const d = new Date(date + "T00:00:00");
  d.setDate(d.getDate() + days);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function weekdayOf(date: string): string {
  return WEEKDAY_CN[new Date(date + "T00:00:00").getDay()];
}

function nowHHMM(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 待办的“发生日期”:来源时间优先,其次完成标记;站内新建无日期时为 null。 */
function todoDate(t: TodoItem): string | null {
  const fromSource = t.sourceText.match(/(\d{4}-\d{2}-\d{2})/);
  if (fromSource) return fromSource[1];
  const fromNote = t.note.match(/已于 (\d{4}-\d{2}-\d{2})/);
  return fromNote ? fromNote[1] : null;
}

function doneDate(t: TodoItem): string | null {
  const m = t.note.match(/已于 (\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

interface DigestData {
  date: string;
  dueToday: { name: string; group: string }[];
  overdue: { name: string; group: string; due: string }[];
  stale: { name: string; group: string; since: string }[];
  yesterdayEntries: { project: string; date: string; titles: string[] }[];
  yesterdayDone: { name: string; group: string }[];
  newFeedback: { by: string; at: string; todo: string; text: string }[];
  inboxCount: number;
  gitCommitted: boolean | null;
}

function collectDigest(day: string, doGit: boolean): DigestData {
  const yesterday = dateAdd(day, -1);
  const { open, done } = parseTodo(resolve(ROOT, "todo.md"));

  const dueToday = open.filter((t) => t.due === day).map((t) => ({ name: t.name, group: t.group }));
  const overdue = open
    .filter((t) => t.due && t.due < day)
    .sort((a, b) => (a.due < b.due ? -1 : 1))
    .map((t) => ({ name: t.name, group: t.group, due: t.due }));
  const staleBefore = dateAdd(day, -STALE_DAYS);
  const stale = open
    .map((t) => ({ t, d: todoDate(t) }))
    .filter((x) => x.d && x.d <= staleBefore)
    .sort((a, b) => ((a.d ?? "") < (b.d ?? "") ? -1 : 1))
    .slice(0, 8)
    .map((x) => ({ name: x.t.name, group: x.t.group, since: x.d! }));

  const yesterdayEntries: DigestData["yesterdayEntries"] = [];
  for (const p of collect(ROOT)) {
    for (const d of p.days) {
      if (d.date !== yesterday) continue;
      yesterdayEntries.push({
        project: p.name,
        date: d.date,
        titles: d.entries.map((e) => e.title),
      });
    }
  }

  const yesterdayDone = done
    .filter((t) => doneDate(t) === yesterday)
    .map((t) => ({ name: t.name, group: t.group }));

  const newFeedback: DigestData["newFeedback"] = [];
  for (const t of [...open, ...done]) {
    for (const fb of t.feedback) {
      const d = fb.at.match(/(\d{4}-\d{2}-\d{2})/)?.[1] ?? "";
      if (d === yesterday || d === day) {
        newFeedback.push({ by: fb.by, at: fb.at, todo: t.name, text: fb.text });
      }
    }
  }

  return {
    date: day,
    dueToday,
    overdue,
    stale,
    yesterdayEntries,
    yesterdayDone,
    newFeedback,
    inboxCount: listInbox(ROOT).length,
    gitCommitted: doGit ? gitSnapshot(day) : null,
  };
}

/** 显式启用时仅快照独立私有数据仓库。 */
function gitSnapshot(day: string): boolean {
  const result = snapshotData(ROOT, `chore: daily snapshot ${day}`, "WorkNote Digest");
  if (!result.ok) console.error(result.error);
  return result.ok && result.committed;
}

/** 渲染 Markdown 推送正文(晨报)。支持企业微信/钉钉 markdown 语法。 */
function renderMarkdown(d: DigestData): string[] {
  const lines: string[] = [];
  lines.push(`## 📋 WorkNote 晨报 ${d.date} 周${weekdayOf(d.date)}`);
  lines.push("");

  if (d.overdue.length) {
    lines.push(`<font color="warning">**⏰ 已逾期 ${d.overdue.length} 条**</font>`);
    for (const t of d.overdue.slice(0, 8)) {
      lines.push(`> ${t.name}`);
      lines.push(`> <font color="comment">逾期至 ${t.due} · ${t.group}</font>`);
    }
    lines.push("");
  }

  if (d.dueToday.length) {
    lines.push(`<font color="warning">**📅 今日到期 ${d.dueToday.length} 条**</font>`);
    for (const t of d.dueToday.slice(0, 8)) {
      lines.push(`> ${t.name}`);
      lines.push(`> <font color="comment">${t.group}</font>`);
    }
    lines.push("");
  }

  if (d.stale.length) {
    lines.push(`<font color="comment">**🐌 滞留超 ${STALE_DAYS} 天 ${d.stale.length} 条**</font>`);
    for (const t of d.stale) {
      lines.push(`> ${t.name}`);
      lines.push(`> <font color="comment">自 ${t.since} · ${t.group}</font>`);
    }
    lines.push("");
  }

  if (d.yesterdayEntries.length) {
    const total = d.yesterdayEntries.reduce((s, x) => s + x.titles.length, 0);
    lines.push(`**📝 昨日记录 ${total} 条**`);
    for (const x of d.yesterdayEntries) {
      const titles = x.titles.slice(0, 3).join("；");
      lines.push(`> **${x.project}** ${titles}${x.titles.length > 3 ? " 等" : ""}`);
    }
    lines.push("");
  }

  if (d.yesterdayDone.length) {
    lines.push(`**✅ 昨日完成 ${d.yesterdayDone.length} 条**`);
    for (const t of d.yesterdayDone.slice(0, 8)) {
      lines.push(`> ~~${t.name}~~ <font color="comment">${t.group}</font>`);
    }
    lines.push("");
  }

  if (d.newFeedback.length) {
    lines.push(`<font color="info">**💬 新到反馈 ${d.newFeedback.length} 条**</font>`);
    for (const fb of d.newFeedback.slice(0, 6)) {
      lines.push(`> **[${fb.by}]** 对「${fb.todo}」`);
      lines.push(`> <font color="comment">${fb.text.slice(0, 80) || "(图片)"}</font>`);
    }
    lines.push("");
  }

  if (d.inboxCount) {
    lines.push(`<font color="info">**📬 收件箱 ${d.inboxCount} 条未整理**</font>`);
  }

  if (lines.length <= 2) {
    lines.push("✅ 一切平静——无逾期、无到期、无滞留待办，昨日无新记录与反馈。");
  }

  return lines;
}

async function main(): Promise<void> {
  let day = today();
  let doSend = true;
  let doGit = process.env.WORKNOTE_GIT_SNAPSHOT === "1";
  let asJson = false;
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--date") {
      const v = argv[++i];
      if (!v || !DATE_RE.test(v)) {
        console.error("--date 需为 YYYY-MM-DD");
        process.exit(1);
      }
      day = v;
      doSend = false; // 指定日期视为回放,默认不推送、不提交
      doGit = false;
    } else if (a === "--no-send") doSend = false;
    else if (a === "--no-git") doGit = false;
    else if (a === "--json") asJson = true;
    else if (a === "--send") doSend = true;
    else {
      console.error(`未知参数: ${a}`);
      process.exit(1);
    }
  }

  const data = collectDigest(day, doGit);

  if (asJson) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  const lines = renderMarkdown(data);
  console.log(lines.join("\n"));
  if (data.gitCommitted === true) console.log("(git 快照已提交)");
  if (doSend) {
    if (notifyConfigured()) {
      const ok = await sendNotify(`WorkNote 晨报 ${day}`, lines, undefined, true);
      console.log(ok ? "(已推送)" : "(推送失败,见上方日志)");
    } else {
      console.log("(未配置 WORKNOTE_NOTIFY_WEBHOOK,仅打印)");
    }
  }
}

void main();
