import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, useAsync } from "../api";
import { PageHead } from "../components/Layout";
import { Placeholder } from "../components/Metabox";
import { TypeTag } from "../components/Tags";
import type { AiAskResponse } from "../types";

/** 关键词搜索(记录条目 + 待办清单)。 */
function KeywordPane({ q }: { q: string }) {
  const [, setParams] = useSearchParams();
  const [input, setInput] = useState(q);

  useEffect(() => {
    setInput(q);
  }, [q]);

  const { data, loading, error } = useAsync(() => api.search(q), [q]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const next = input.trim();
    if (next) setParams({ q: next, mode: "kw" });
    else setParams({ mode: "kw" });
  }

  return (
    <>
      <form onSubmit={submit} className="mt-5 flex max-w-[560px] gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="输入关键词,如 月报、立项、整改…(同时搜索记录与待办)"
          autoFocus
          className="min-w-0 flex-1 rounded-md border border-line bg-surface px-3 py-2 text-[14px] text-ink outline-none transition focus:border-accent"
        />
        <button
          type="submit"
          className="btn-primary"
        >
          搜索
        </button>
      </form>

      {!q && <Placeholder kind="empty" text="输入关键词开始搜索" />}
      {loading && <Placeholder kind="loading" text="搜索中..." />}
      {error && <Placeholder kind="error" text={`搜索失败:${error}`} />}

      {data && q && !loading && (
        <>
          <h2 className="section-title">记录命中 {data.items.length} 条</h2>
          {!data.items.length && <Placeholder kind="empty" text="没有匹配的记录" />}
          <ul className="m-0 list-none p-0">
            {data.items.map((h, i) => (
              <li
                key={`${h.slug}-${h.date}-${h.anchor}-${i}`}
                className="border-t border-line-soft py-3.5 first:border-t-0"
              >
                <div className="flex flex-wrap items-baseline gap-2.5">
                  <span className="text-[12.5px] tabular-nums text-ink-muted">{h.time}</span>
                  <Link
                    to={`/days/${h.slug}/${h.date}#${h.anchor}`}
                    className="text-[14.5px] text-ink hover:text-accent"
                  >
                    {h.title}
                  </Link>
                  <TypeTag type={h.type} />
                </div>
                <div className="mt-0.5 text-[12.5px] text-ink-muted">
                  {h.projectName} · {h.module || "—"}
                </div>
                {h.snippet && (
                  <div className="mt-1 line-clamp-2 text-[12.5px] leading-[1.7] text-ink-2">
                    {h.snippet}
                  </div>
                )}
                <div className="mt-1 text-[12.5px] text-ink-muted">
                  <Link
                    to={`/days/${h.slug}/${h.date}#${h.anchor}`}
                    className="text-ink-muted underline decoration-line hover:text-accent hover:decoration-current"
                  >
                    {h.date} 星期{h.weekday}
                  </Link>
                </div>
              </li>
            ))}
          </ul>

          <h2 className="section-title mt-8">待办命中 {data.todos.length} 条</h2>
          {!data.todos.length && <Placeholder kind="empty" text="没有匹配的待办" />}
          <ul className="m-0 list-none p-0">
            {data.todos.map((t, i) => (
              <li key={`${t.name}-${i}`} className="border-t border-line-soft py-3.5 first:border-t-0">
                <div className="flex flex-wrap items-baseline gap-2.5">
                  <span
                    className={`rounded px-1.5 py-px text-[11.5px] ${
                      t.status === "open" ? "bg-accent-tint text-accent" : "bg-line-soft text-ink-muted"
                    }`}
                  >
                    {t.status === "open" ? "未完成" : "已完成"}
                  </span>
                  <Link to="/todo" className="text-[14.5px] text-ink hover:text-accent">
                    {t.name}
                  </Link>
                  {!!t.type && <TypeTag type={t.type} />}
                  {!!t.due && (
                    <span className="text-[12px] tabular-nums text-ink-muted">预计 {t.due}</span>
                  )}
                </div>
                <div className="mt-0.5 text-[12.5px] text-ink-muted">{t.group || "—"}</div>
                {t.snippet && (
                  <div className="mt-1 line-clamp-2 text-[12.5px] leading-[1.7] text-ink-2">
                    {t.snippet}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

/** AI 问答:基于检索资料回答自然语言问题。 */
function AiPane() {
  const [input, setInput] = useState("");
  const [asking, setAsking] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<AiAskResponse | null>(null);
  const { data: ai } = useAsync(() => api.aiStatus(), []);

  async function ask(e?: React.FormEvent) {
    e?.preventDefault();
    const q = input.trim();
    if (!q || asking) return;
    setAsking(true);
    setErr(null);
    setResult(null);
    try {
      setResult(await api.aiAsk(q));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setAsking(false);
    }
  }

  if (ai && !ai.configured) {
    return (
      <Placeholder
        kind="empty"
        text="AI 未配置(缺少 WORKNOTE_AI_URL / WORKNOTE_AI_KEY),问答不可用;关键词搜索不受影响"
      />
    );
  }

  return (
    <>
      <form onSubmit={ask} className="mt-5">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void ask();
          }}
          rows={2}
          autoFocus
          placeholder="用自然语言问，如：上个月有哪些待排查事项？之前反馈的问题后来怎么样了？"
          className="w-full max-w-[720px] rounded-md border border-line bg-surface px-3 py-2 text-[14px] leading-[1.7] text-ink outline-none transition focus:border-accent"
        />
        <div className="mt-2 flex items-center gap-3">
          <button
            type="submit"
            disabled={asking || !input.trim()}
            className="btn-primary"
          >
            {asking ? "思考中…" : "提问"}
          </button>
          <span className="text-[12px] text-ink-muted">Ctrl+Enter 发送 · 仅依据库内记录与待办作答</span>
        </div>
      </form>

      {asking && <Placeholder kind="loading" text="检索记录并让 AI 归纳…" />}
      {err && <Placeholder kind="error" text={`问答失败:${err}`} />}

      {result && (
        <div className="mt-5 max-w-[760px]">
          <h2 className="section-title">回答</h2>
          <div className="whitespace-pre-wrap rounded-md border border-line bg-surface px-4 py-3.5 text-[14px] leading-[1.85] text-ink">
            {result.answer}
          </div>
          {!!result.refs.length && (
            <>
              <h2 className="section-title mt-6">参考资料</h2>
              <ul className="m-0 list-none p-0">
                {result.refs.map((r, i) => (
                  <li key={i} className="border-t border-line-soft py-2 first:border-t-0">
                    <Link
                      to={r.to}
                      className="text-[13px] text-ink-2 underline decoration-line hover:text-accent hover:decoration-current"
                    >
                      [{r.kind === "record" ? "记录" : "待办"}] {r.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </>
  );
}

export function SearchPage() {
  const [params, setParams] = useSearchParams();
  const mode = params.get("mode") === "ai" ? "ai" : "kw";
  const q = params.get("q") ?? "";

  function switchMode(next: "kw" | "ai") {
    const p = new URLSearchParams();
    if (next === "kw" && q) p.set("q", q);
    if (next !== mode) p.set("mode", next);
    setParams(p);
  }

  return (
    <>
      <PageHead title="搜索" subtitle="关键词检索记录与待办,或用自然语言向 AI 提问" />

      <div className="mt-4 inline-flex rounded-md border border-line bg-surface p-0.5">
        <button
          type="button"
          onClick={() => switchMode("kw")}
          className={`rounded px-3.5 py-1.5 text-[13px] transition ${
            mode === "kw" ? "bg-accent-tint font-medium text-accent" : "text-ink-2 hover:text-ink"
          }`}
        >
          关键词搜索
        </button>
        <button
          type="button"
          onClick={() => switchMode("ai")}
          className={`rounded px-3.5 py-1.5 text-[13px] transition ${
            mode === "ai" ? "bg-accent-tint font-medium text-accent" : "text-ink-2 hover:text-ink"
          }`}
        >
          AI 问答
        </button>
      </div>

      {mode === "kw" ? <KeywordPane q={q} /> : <AiPane />}
    </>
  );
}
