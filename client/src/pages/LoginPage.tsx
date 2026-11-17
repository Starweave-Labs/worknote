import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { PageHead } from "../components/Layout";
import { Placeholder } from "../components/Metabox";

export function LoginPage() {
  const { refresh, configured } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.login(password);
      await refresh();
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (configured === false) {
    return (
      <>
        <PageHead title="登录" />
        <Placeholder
          kind="error"
          text="后端尚未配置登录口令(缺少 WORKNOTE_PASSWORD / WORKNOTE_SECRET),请联系管理员。"
        />
      </>
    );
  }

  return (
    <>
      <PageHead title="登录" subtitle="输入访问口令以查看工作记录" />
      <form onSubmit={submit} className="mt-6 max-w-[360px]">
        <label className="mb-1.5 block text-[12.5px] text-ink-muted" htmlFor="pw">
          访问口令
        </label>
        <input
          id="pw"
          type="password"
          value={password}
          autoFocus
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-md border border-line bg-surface px-3 py-2 text-[14px] text-ink outline-none transition focus:border-accent"
          placeholder="请输入口令"
        />
        {error && <p className="mt-2 text-[13px] text-t3">{error}</p>}
        <button
          type="submit"
          disabled={busy || !password}
          className="mt-4 rounded-md bg-accent px-4 py-2 text-[14px] text-white transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? "登录中…" : "登录"}
        </button>
      </form>
    </>
  );
}