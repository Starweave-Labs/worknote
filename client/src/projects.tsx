import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { api } from "./api";
import { useAuth } from "./auth";
import type { ProjectSummary } from "./types";

interface ProjectState {
  projects: ProjectSummary[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

const ProjectContext = createContext<ProjectState>({
  projects: [],
  loading: true,
  error: null,
  refresh: async () => {},
});

export function useProjects() {
  return useContext(ProjectContext);
}

/** 项目目录只在登录后加载，共用于导航与表单；登出立即清空。 */
export function ProjectProvider({ children }: { children: React.ReactNode }) {
  const { authed } = useAuth();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  const refresh = useCallback(async () => {
    if (authed !== true) return;
    const id = ++requestId.current;
    setLoading(true);
    setError(null);
    try {
      const result = await api.projects();
      if (id === requestId.current) setProjects(result.projects);
    } catch (e) {
      if (id === requestId.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [authed]);

  useEffect(() => {
    if (authed !== true) {
      ++requestId.current;
      setProjects([]);
      setError(null);
      setLoading(true);
      return;
    }
    void refresh();
    return () => { ++requestId.current; };
  }, [authed, refresh]);

  return (
    <ProjectContext.Provider value={{
      projects: authed === true ? projects : [],
      loading,
      error: authed === true ? error : null,
      refresh,
    }}>
      {children}
    </ProjectContext.Provider>
  );
}

/** 项目目录的统一加载、重试与初始化提示。 */
export function ProjectNotice({ compact = false }: { compact?: boolean }) {
  const { authed } = useAuth();
  const { projects, loading, error, refresh } = useProjects();
  if (!authed || (!loading && !error && projects.length)) return null;

  const text = loading
    ? "正在加载项目…"
    : error
      ? `项目加载失败：${error}`
      : "暂无项目。请在数据目录的 projects.json 中添加项目，或在后端目录运行 npm run init -- --project <slug> --name <名称>，然后刷新项目列表。";

  if (compact) {
    return (
      <button
        type="button"
        title={text}
        aria-label={text}
        disabled={loading}
        onClick={() => void refresh()}
        className="btn-ghost w-full px-1"
      >
        {loading ? "…" : "?"}
      </button>
    );
  }

  return (
    <div role={error ? "alert" : "status"} className="text-[12.5px] leading-[1.7] text-ink-muted">
      <p className="m-0 break-words">{text}</p>
      {!loading && (
        <button type="button" onClick={() => void refresh()} className="btn-ghost mt-1">
          {error ? "重试加载项目" : "刷新项目列表"}
        </button>
      )}
    </div>
  );
}
