/**
 * 设置页:站点统一配置(保存到 site-config.json,优先于 env,即时生效)。
 *
 * 四段：整理 Agent、AI 网关、通知与晨报、登录口令。
 * 默认不启用系统调度，保存配置与定时器同步状态分开展示。
 * 密钥/口令只回传打码值,表单留空表示不修改;notifyWebhook/口令填空串保存=清除该项。
 */
import { useEffect, useState } from "react";
import { api, useAsync } from "../api";
import { PageHead } from "../components/Layout";
import { Placeholder } from "../components/Metabox";

type Msg = { kind: "ok" | "err"; text: string } | null;

const inputCls = "input";

function Note({ msg }: { msg: Msg }) {
  if (!msg) return null;
  return <p className={`m-0 text-[13px] ${msg.kind === "ok" ? "text-accent" : "text-t3"}`}>{msg.text}</p>;
}

/** 整理 Agent 段:级别选择 + 立即运行 + 最近结果。 */
function AgentSection() {
  const { data, loading, error, refetch } = useAsync(() => api.agentStatus(), []);
  const [level, setLevel] = useState<"" | "off" | "L1" | "L2">("");
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState<"none" | "save" | "run">("none");

  useEffect(() => {
    if (data) setLevel(data.level);
  }, [data]);

  async function save() {
    if (busy !== "none" || !level) return;
    setBusy("save");
    setMsg(null);
    try {
      await api.saveSettings({ agentLevel: level });
      await refetch();
      setMsg({ kind: "ok", text: "级别已保存；定时运行需另行配置调度器" });
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy("none");
    }
  }

  async function runNow() {
    if (busy !== "none") return;
    setBusy("run");
    setMsg(null);
    try {
      await api.agentRun();
      setMsg({ kind: "ok", text: "已启动(约 1~3 分钟),稍后刷新查看结果" });
      setTimeout(() => void refetch(), 5000);
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy("none");
    }
  }

  return (
    <section className="rounded-md border border-line bg-surface p-4">
      <h2 className="m-0 mb-3 text-[15.5px] font-semibold">整理 Agent</h2>
      {loading && <p className="m-0 text-[13px] text-ink-muted">加载中…</p>}
      {error && <Placeholder kind="error" text={`Agent 状态加载失败：${error}`} />}
      {data && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3 text-[12.5px] text-ink-muted">
            <span className={`rounded px-2 py-0.5 ${data.running ? "bg-accent-tint text-accent" : "bg-line-soft"}`}>
              {data.running ? "运行中…" : "空闲"}
            </span>
            {data.last && (
              <span>
                上次 {data.last.startedAt}:执行 {data.last.executed ?? 0} · 建议 {data.last.suggested ?? 0} · 转人工{" "}
                {data.last.pendingReview ?? 0} · {data.last.rolledBack ? "已回滚" : data.last.validationOk ? "校验通过" : "校验失败"}
              </span>
            )}
          </div>
          {data.last?.summary && (
            <p className="m-0 rounded border border-line-soft bg-surface-2 px-3 py-2 text-[12.5px] leading-[1.7] text-ink-2">
              {data.last.summary}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={level}
              onChange={(e) => setLevel(e.target.value as "off" | "L1" | "L2")}
              className="rounded-md border border-line bg-surface px-3 py-2 text-[14px] text-ink outline-none focus:border-accent"
            >
              <option value="L2">L2 自主(自动执行安全操作,合并类转人工)</option>
              <option value="L1">L1 预览(只出建议报告,不改文件)</option>
              <option value="off">关闭(不自动运行)</option>
            </select>
            <button type="button" onClick={() => void save()} disabled={busy !== "none"} className="btn-primary">
              {busy === "save" ? "保存中…" : "保存级别"}
            </button>
            <button
              type="button"
              onClick={() => void runNow()}
              disabled={busy !== "none" || data.running || data.level === "off"}
              className="btn-secondary"
            >
              {busy === "run" ? "启动中…" : "立即运行"}
            </button>
          </div>
          <Note msg={msg} />
          <p className="m-0 text-[12.5px] leading-[1.8] text-ink-muted">
            可归档收件箱、补概要、补待办缺口与整理已完成项；合并重复/补元数据只出建议转人工。
            默认不自动运行。立即运行需管理员启用服务端 systemd 集成，或在后端目录通过 npm run agent -- --run 手动执行；定时运行可自行配置调度器。日志位于数据目录 agent/runs/。
          </p>
        </div>
      )}
    </section>
  );
}

export function SettingsPage() {
  const { data, loading, error, refetch } = useAsync(() => api.settings(), []);

  /* ---- AI 网关 ---- */
  const [aiUrl, setAiUrl] = useState("");
  const [aiKey, setAiKey] = useState("");
  const [aiModel, setAiModel] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [busy, setBusy] = useState<"none" | "saveAi" | "models" | "testAi" | "saveNotify" | "testNotify" | "savePw" | "reset">("none");
  const [aiMsg, setAiMsg] = useState<Msg>(null);

  /* ---- 通知与晨报 ---- */
  const [webhook, setWebhook] = useState("");
  const [digestTime, setDigestTime] = useState("08:30");
  const [staleDays, setStaleDays] = useState(14);
  const [notifyMsg, setNotifyMsg] = useState<Msg>(null);

  /* ---- 登录口令 ---- */
  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");
  const [pwMsg, setPwMsg] = useState<Msg>(null);

  useEffect(() => {
    if (!data) return;
    setAiUrl(data.ai.url);
    setAiModel(data.ai.model);
    setDigestTime(data.digest.time);
    setStaleDays(data.digest.staleDays);
  }, [data]);

  function aiDiff(): { url?: string; key?: string; model?: string } {
    const cfg: { url?: string; key?: string; model?: string } = {};
    if (aiUrl.trim() && aiUrl.trim() !== data?.ai.url) cfg.url = aiUrl.trim();
    if (aiKey.trim()) cfg.key = aiKey.trim();
    if (aiModel.trim() && aiModel.trim() !== data?.ai.model) cfg.model = aiModel.trim();
    return cfg;
  }

  async function saveAi() {
    if (busy !== "none") return;
    const cfg = aiDiff();
    if (!Object.keys(cfg).length) {
      setAiMsg({ kind: "err", text: "没有改动可保存" });
      return;
    }
    setBusy("saveAi");
    setAiMsg(null);
    try {
      await api.saveSettings({ ai: cfg });
      setAiKey("");
      setModels([]);
      await refetch();
      setAiMsg({ kind: "ok", text: "已保存,即时生效(无需重启)" });
    } catch (e) {
      setAiMsg({ kind: "err", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy("none");
    }
  }

  async function fetchModels() {
    if (busy !== "none") return;
    setBusy("models");
    setAiMsg(null);
    try {
      const diff = aiDiff();
      const r = await api.aiModels({ url: diff.url, key: diff.key });
      setModels(r.models);
      setAiMsg({ kind: "ok", text: `拉取到 ${r.models.length} 个模型,在「模型」框输入时可选` });
    } catch (e) {
      setAiMsg({ kind: "err", text: `拉取失败:${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setBusy("none");
    }
  }

  async function testAiConn() {
    if (busy !== "none") return;
    setBusy("testAi");
    setAiMsg(null);
    try {
      const r = await api.aiTest(aiDiff());
      setAiMsg({ kind: "ok", text: `测试通过:${r.ms}ms,模型回复「${r.reply}」` });
    } catch (e) {
      setAiMsg({ kind: "err", text: `测试失败:${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setBusy("none");
    }
  }

  async function saveNotify() {
    if (busy !== "none") return;
    setBusy("saveNotify");
    setNotifyMsg(null);
    try {
      const body: { notifyWebhook?: string; digestTime?: string; staleDays?: number } = {};
      const wh = webhook.trim();
      if (wh !== "") body.notifyWebhook = wh; // 非空才动;清除走清空按钮
      if (digestTime !== data?.digest.time) body.digestTime = digestTime;
      if (staleDays !== data?.digest.staleDays) body.staleDays = staleDays;
      if (!Object.keys(body).length) {
        setNotifyMsg({ kind: "err", text: "没有改动可保存" });
        return;
      }
      const r = await api.saveSettings(body);
      setWebhook("");
      await refetch();
      setNotifyMsg({
        kind: "ok",
        text: "配置已保存，即时生效" +
          (body.digestTime
            ? r.timerSynced === true
              ? `；系统定时器已同步到 ${body.digestTime}`
              : `；${r.timer?.error || r.message || "未同步系统定时器，请自行配置外部调度器"}`
            : r.message ? `；${r.message}` : ""),
      });
    } catch (e) {
      setNotifyMsg({ kind: "err", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy("none");
    }
  }

  async function testNotify() {
    if (busy !== "none") return;
    setBusy("testNotify");
    setNotifyMsg(null);
    try {
      await api.notifyTest(webhook.trim() || undefined);
      setNotifyMsg({ kind: "ok", text: "测试通知已发出,去接收端确认收到" });
    } catch (e) {
      setNotifyMsg({ kind: "err", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy("none");
    }
  }

  async function savePassword() {
    if (busy !== "none") return;
    if (pw1 !== pw2) {
      setPwMsg({ kind: "err", text: "两次输入的口令不一致" });
      return;
    }
    if (pw1 && pw1.length < 6) {
      setPwMsg({ kind: "err", text: "口令至少 6 位" });
      return;
    }
    setBusy("savePw");
    setPwMsg(null);
    try {
      await api.saveSettings({ password: pw1 }); // 空串=清除覆盖回落 env
      setPw1("");
      setPw2("");
      await refetch();
      setPwMsg({
        kind: "ok",
        text: pw1 ? "口令已更新,即时生效;已登录的会话不受影响" : "已清除口令覆盖,回落到环境变量口令",
      });
    } catch (e) {
      setPwMsg({ kind: "err", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy("none");
    }
  }

  async function resetAll() {
    if (busy !== "none") return;
    if (!window.confirm("清空全部站点覆盖配置（Agent/AI/通知/晨报/口令），回落到环境变量/.env？")) return;
    setBusy("reset");
    try {
      const result = await api.saveSettings({ reset: true });
      setAiKey("");
      setWebhook("");
      setPw1("");
      setPw2("");
      setModels([]);
      await refetch();
      setAiMsg({
        kind: "ok",
        text: "已清空覆盖，全部回落到环境变量/.env" +
          (result.timerSynced === true
            ? "；系统定时器已同步"
            : `；${result.timer?.error || result.message || "未同步系统定时器，请自行配置外部调度器"}`),
      });
    } catch (e) {
      setAiMsg({ kind: "err", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy("none");
    }
  }

  if (loading) return <><PageHead title="设置" /><Placeholder kind="loading" text="加载配置中..." /></>;
  if (error || !data) {
    return <><PageHead title="设置" /><Placeholder kind="error" text={`加载失败:${error}`}></Placeholder></>;
  }

  return (
    <>
      <PageHead
        title="设置"
        subtitle="配置保存到数据目录 site-config.json（优先于环境变量/.env，含密钥不入 git），保存即生效；定时任务需另行配置调度"
      />

      <div className="mt-5 max-w-[680px] space-y-6">
        {/* ---------- 整理 Agent ---------- */}
        <AgentSection />

        {/* ---------- AI 网关 ---------- */}
        <section className="rounded-md border border-line bg-surface p-4">
          <h2 className="m-0 mb-3 text-[15.5px] font-semibold">AI 网关</h2>
          <div className="mb-3 flex flex-wrap gap-2 text-[12.5px] text-ink-muted">
            <span className={`rounded px-2 py-0.5 ${data.ai.configured ? "bg-accent-tint text-accent" : "bg-t3/10 text-t3"}`}>
              {data.ai.configured ? "已配置" : "未配置"}
            </span>
            <span>
              模型 {data.ai.model || "（未设置）"} · 密钥 {data.ai.keyMasked || "(空)"} · 来源 {data.ai.source === "override" ? "站点覆盖" : "环境变量/.env"}
            </span>
          </div>
          <div className="space-y-4">
            <label className="block">
              <span className="mb-1 block text-[13px] font-medium text-ink">网关地址</span>
              <input value={aiUrl} onChange={(e) => setAiUrl(e.target.value)} placeholder="https://…(OpenAI 兼容)" className={inputCls} />
            </label>
            <label className="block">
              <span className="mb-1 block text-[13px] font-medium text-ink">
                密钥{data.ai.keyMasked ? `(现有 ${data.ai.keyMasked},留空不改)` : ""}
              </span>
              <input type="password" value={aiKey} onChange={(e) => setAiKey(e.target.value)} placeholder="sk-…" autoComplete="new-password" className={inputCls} />
            </label>
            <label className="block">
              <span className="mb-1 block text-[13px] font-medium text-ink">模型{models.length ? "(可从列表选择)" : "(可先「拉取模型列表」)"}</span>
              <input value={aiModel} onChange={(e) => setAiModel(e.target.value)} list="ai-model-list" placeholder="填写网关提供的模型 ID" className={inputCls} />
              <datalist id="ai-model-list">
                {models.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </label>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => void saveAi()} disabled={busy !== "none"} className="btn-primary">
                {busy === "saveAi" ? "保存中…" : "保存本区"}
              </button>
              <button type="button" onClick={() => void testAiConn()} disabled={busy !== "none" || !aiModel.trim()} className="btn-secondary">
                {busy === "testAi" ? "测试中…" : "测试连接"}
              </button>
              <button type="button" onClick={() => void fetchModels()} disabled={busy !== "none"} className="btn-secondary">
                {busy === "models" ? "拉取中…" : "拉取模型列表"}
              </button>
            </div>
            <Note msg={aiMsg} />
          </div>
        </section>

        {/* ---------- 通知与晨报 ---------- */}
        <section className="rounded-md border border-line bg-surface p-4">
          <h2 className="m-0 mb-3 text-[15.5px] font-semibold">通知与晨报</h2>
          <div className="mb-3 flex flex-wrap gap-2 text-[12.5px] text-ink-muted">
            <span className={`rounded px-2 py-0.5 ${data.notify.configured ? "bg-accent-tint text-accent" : "bg-line-soft"}`}>
              {data.notify.configured ? "推送已配置" : "未配置推送"}
            </span>
            {data.notify.webhookMasked && <span>{data.notify.webhookMasked}</span>}
            <span>· 晨报配置时间 {data.digest.time}（需配置调度）· 滞留阈值 {data.digest.staleDays} 天</span>
          </div>
          <div className="space-y-4">
            <label className="block">
              <span className="mb-1 block text-[13px] font-medium text-ink">
                通知 Webhook{data.notify.webhookMasked ? `(现有 ${data.notify.webhookMasked})` : "(企业微信/飞书/钉钉群机器人或通用接口)"}
              </span>
              <input value={webhook} onChange={(e) => setWebhook(e.target.value)} placeholder="https://…(企业微信/飞书/钉钉群机器人 Webhook，留空=不修改)" className={inputCls} />
            </label>
            <div className="flex flex-wrap gap-4">
              <label className="block">
                <span className="mb-1 block text-[13px] font-medium text-ink">晨报时间</span>
                <input type="time" value={digestTime} onChange={(e) => setDigestTime(e.target.value)} className={inputCls} />
              </label>
              <label className="block">
                <span className="mb-1 block text-[13px] font-medium text-ink">滞留阈值(天)</span>
                <input type="number" min={3} max={90} value={staleDays} onChange={(e) => setStaleDays(Number(e.target.value))} className={inputCls} />
              </label>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => void saveNotify()} disabled={busy !== "none"} className="btn-primary">
                {busy === "saveNotify" ? "保存中…" : "保存本区"}
              </button>
              <button type="button" onClick={() => void testNotify()} disabled={busy !== "none"} className="btn-secondary">
                {busy === "testNotify" ? "推送中…" : "测试推送"}
              </button>
            </div>
            <Note msg={notifyMsg} />
            <p className="m-0 text-[12.5px] leading-[1.8] text-ink-muted">
              晨报内容：逾期/今日到期/滞留待办、昨日记录与完成、新到反馈、收件箱未整理数。默认不自动推送；请自行配置 cron、systemd 或其他调度器。保存时间只更新配置，是否同步系统定时器以返回提示为准。
            </p>
          </div>
        </section>

        {/* ---------- 登录口令 ---------- */}
        <section className="rounded-md border border-line bg-surface p-4">
          <h2 className="m-0 mb-3 text-[15.5px] font-semibold">登录口令</h2>
          <div className="mb-3 text-[12.5px] text-ink-muted">
            当前来源:{data.password.source}
            {data.password.overridden ? "（站点覆盖）" : "（环境变量/.env）"}
          </div>
          <div className="space-y-4">
            <div className="flex flex-wrap gap-4">
              <label className="block min-w-[200px] flex-1">
                <span className="mb-1 block text-[13px] font-medium text-ink">新口令(≥6 位)</span>
                <input type="password" value={pw1} onChange={(e) => setPw1(e.target.value)} autoComplete="new-password" className={inputCls} />
              </label>
              <label className="block min-w-[200px] flex-1">
                <span className="mb-1 block text-[13px] font-medium text-ink">再输入一次</span>
                <input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" className={inputCls} />
              </label>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => void savePassword()} disabled={busy !== "none" || (!pw1 && !pw2)} className="btn-primary">
                {busy === "savePw" ? "保存中…" : "保存口令"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setPw1("");
                  setPw2("");
                  void savePassword();
                }}
                disabled={busy !== "none" || !data.password.overridden}
                className="rounded-md border border-line px-3.5 py-2 text-[13.5px] text-ink-muted transition hover:border-t3 hover:text-t3 disabled:opacity-40"
                title={data.password.overridden ? "删除覆盖,恢复使用环境变量里的口令" : "当前未使用站点覆盖口令"}
              >
                清除覆盖（恢复环境变量口令）
              </button>
            </div>
            <Note msg={pwMsg} />
            <p className="m-0 text-[12.5px] leading-[1.8] text-ink-muted">
              改口令即时生效且不影响已登录会话;两个框都留空再点「清除覆盖」即恢复环境变量口令。忘了覆盖口令时,删除 site-config.json 亦可回落。
            </p>
          </div>
        </section>

        <div className="flex items-center justify-between border-t border-line-soft pt-4">
          <span className="text-[12.5px] text-ink-muted">覆盖文件:site-config.json(权限 600,不入 git)</span>
          <button
            type="button"
            onClick={() => void resetAll()}
            disabled={busy !== "none"}
            className="rounded-md border border-line px-3 py-1.5 text-[12.5px] text-ink-muted transition hover:border-t3 hover:text-t3 disabled:opacity-50"
          >
            清空全部覆盖
          </button>
        </div>
      </div>
    </>
  );
}
