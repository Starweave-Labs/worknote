/** 极简 API 客户端 + 一个轻量的请求状态 Hook。 */

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  Overview,
  TodoResponse,
  ProjectDetail,
  ProjectsResponse,
  DayResponse,
  RecordsResponse,
  SearchResponse,
  MeResponse,
  Share,
  SharesResponse,
  SharePayload,
  ShareMode,
  AiAskResponse,
  InboxResponse,
  ReportResponse,
  TodoMutationResponse,
  ShareTodoMutationResponse,
} from "./types";

const BASE = "/api";

/** 401 时由 AuthProvider 注册的回调触发跳登录。 */
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: (() => void) | null) {
  onUnauthorized = fn;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, {
    credentials: "same-origin",
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  if (res.status === 401) {
    onUnauthorized?.();
    throw new Error("需要登录");
  }
  if (!res.ok) {
    let msg = `请求失败 (${res.status})`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) msg = body.error;
    } catch {
      /* 保持默认文案 */
    }
    throw new Error(msg);
  }
  return (await res.json()) as T;
}

const get = <T,>(path: string) => request<T>(path);
const post = <T,>(path: string, body?: unknown) =>
  request<T>(path, { method: "POST", body: body === undefined ? "{}" : JSON.stringify(body) });
const del = <T,>(path: string) => request<T>(path, { method: "DELETE" });
const patch = <T,>(path: string, body?: unknown) =>
  request<T>(path, { method: "PATCH", body: body === undefined ? "{}" : JSON.stringify(body) });

export const api = {
  overview: () => get<Overview>("/overview"),
  todo: () => get<TodoResponse>("/todo"),
  projects: () => get<ProjectsResponse>("/projects"),
  project: (slug: string) => get<ProjectDetail>(`/projects/${encodeURIComponent(slug)}`),
  day: (slug: string, date: string) => get<DayResponse>(`/days/${slug}/${date}`),
  records: (offset: number, limit: number) =>
    get<RecordsResponse>(`/records?offset=${offset}&limit=${limit}`),
  search: (q: string) => get<SearchResponse>(`/search?q=${encodeURIComponent(q)}`),
  aiAsk: (q: string) => post<AiAskResponse>("/ai/ask", { q }),
  inbox: () => get<InboxResponse>("/inbox"),
  addInbox: (text: string, images: { dataUrl: string; alt?: string }[]) =>
    post<{ ok: true; id: string; count: number }>("/inbox", { text, images }),
  removeInbox: (id: string) =>
    request<{ ok: true; count: number }>("/inbox", {
      method: "DELETE",
      body: JSON.stringify({ id }),
    }),
  report: (from: string, to: string) => get<ReportResponse>(`/report?from=${from}&to=${to}`),
  projectModules: (slug: string) => get<import("./types").ModulesResponse>(`/modules/${slug}`),
  saveModule: (slug: string, body: { name: string; oldName?: string; sub?: string; oldSub?: string; status?: string; progress?: number; note?: string }) =>
    post<{ ok: true; modules: import("./types").ModuleItem[] }>(`/modules/${slug}`, body),
  removeModule: (slug: string, name: string, sub?: string) =>
    request<{ ok: true; modules: import("./types").ModuleItem[] }>(`/modules/${slug}`, {
      method: "DELETE",
      body: JSON.stringify(sub ? { name, sub } : { name }),
    }),
  me: () => get<MeResponse>("/me"),
  login: (password: string) => post<{ ok: true }>("/login", { password }),
  logout: () => post<{ ok: true }>("/logout"),
  shares: () => get<SharesResponse>("/shares"),
  createShare: (project: string, mode: ShareMode, label: string, feedbackBy: string) =>
    post<Share>("/shares", { project, mode, label, feedbackBy }),
  revokeShare: (token: string) => del<{ ok: true }>(`/shares/${encodeURIComponent(token)}`),
  updateShare: (token: string, body: { mode?: ShareMode; feedbackBy?: string }) =>
    patch<Share>(`/shares/${encodeURIComponent(token)}`, body),
  share: (token: string) => get<SharePayload>(`/share/${encodeURIComponent(token)}`),
  shareTodo: (token: string, name: string, source: string) =>
    request<ShareTodoMutationResponse>(`/share/${encodeURIComponent(token)}/todo`, {
      method: "POST",
      body: JSON.stringify({ name, source }),
      headers: { "X-Requested-With": "worknote" },
    }),
  replyFeedback: (
    name: string,
    source: string,
    fbIndex: number,
    text: string,
    images: { dataUrl: string; alt?: string }[],
  ) =>
    post<{ ok: true; images: string[] }>("/todos/feedback-reply", {
      name,
      source,
      fbIndex,
      text,
      images,
    }),
  submitFeedback: (
    token: string,
    name: string,
    source: string,
    text: string,
    images: { dataUrl: string; alt?: string }[],
  ) =>
    request<{ ok: true; images: string[] }>(`/share/${encodeURIComponent(token)}/feedback`, {
      method: "POST",
      body: JSON.stringify({ name, source, text, images }),
      headers: { "X-Requested-With": "worknote" },
    }),
  aiStatus: () => get<import("./types").AiStatus>("/ai/status"),
  settings: () => get<import("./types").SettingsResponse>("/settings"),
  saveSettings: (body: {
    ai?: { url?: string; key?: string; model?: string };
    notifyWebhook?: string;
    digestTime?: string;
    staleDays?: number;
    password?: string;
    agentLevel?: import("./types").AgentLevel;
    reset?: boolean;
  }) => post<import("./types").SaveSettingsResult>("/settings", body),
  notifyTest: (webhook?: string) => post<{ ok: true }>("/notify/test", { webhook }),
  agentStatus: () => get<import("./types").AgentStatusResponse>("/agent/status"),
  agentRuns: () => get<import("./types").AgentRunsResponse>("/agent/runs"),
  agentRun: () => post<{ ok: true }>("/agent/run"),
  aiModels: (body: { url?: string; key?: string }) =>
    post<import("./types").AiModelsResponse>("/ai/models", body),
  aiTest: (body: { url?: string; key?: string; model?: string }) =>
    post<import("./types").AiTestResponse>("/ai/test", body),
  createTodo: (body: {
    project: string;
    name: string;
    note?: string;
    priority?: string;
    start?: string;
    due?: string;
    progress?: number;
    type?: string;
    system?: string;
    images?: { dataUrl: string; alt?: string }[];
  }) => post<{ ok: true; group: string; images?: string[] }>("/todos", body),
  updateTodo: (name: string, source: string, patch: import("./types").UpdateTodoPatch) =>
    request<TodoMutationResponse>("/todos", {
      method: "PATCH",
      body: JSON.stringify({ name, source, patch }),
    }),
  deleteTodo: (name: string, source: string) =>
    request<{ ok: true }>("/todos", {
      method: "DELETE",
      body: JSON.stringify({ name, source }),
    }),
  aiParseTodo: (text: string, images: string[]) =>
    post<{ ok: true; draft: import("./types").AiTodoDraft }>("/todos/ai-parse", { text, images }),
  aiCreateTodo: (body: {
    project: string;
    name: string;
    note?: string;
    priority?: string;
    start?: string;
    due?: string;
    progress?: number;
    type?: string;
    system?: string;
    images?: { dataUrl: string; alt?: string }[];
  }) => post<{ ok: true; group: string; images: string[] }>("/todos/ai-create", body),
  undoneTodo: (name: string, source: string) =>
    post<TodoMutationResponse>("/todos/undone", { name, source }),
  completeTodo: (body: {
    name: string;
    source: string;
    project: string;
    text?: string;
    images?: { dataUrl: string; alt?: string }[];
    analyze?: boolean;
  }) => post<TodoMutationResponse>("/todos/complete", body),
};

export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  reloading: boolean;
  error: string | null;
  refetch: () => Promise<T | null>;
  /** 本地写入后的权威快照;同时作废更早的在途请求。 */
  setData: React.Dispatch<React.SetStateAction<T | null>>;
}

/** 加载数据 Hook。支持静默 refetch,刷新时不清空已有数据,避免白屏闪烁与滚动条归零。 */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): AsyncState<T> {
  const [data, setRawData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloading, setReloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fnRef = useRef(fn);
  fnRef.current = fn;
  const reqIdRef = useRef(0);

  const setData = useCallback<React.Dispatch<React.SetStateAction<T | null>>>((next) => {
    // mutation 成功后,更早开始的 GET 即使后到也不能覆盖这份快照。
    ++reqIdRef.current;
    setRawData(next);
    setLoading(false);
    setReloading(false);
    setError(null);
  }, []);

  const execute = useCallback(async (isInitial: boolean) => {
    const curId = ++reqIdRef.current;
    if (isInitial) {
      setLoading(true);
      setError(null);
    } else {
      setReloading(true);
    }

    try {
      const result = await fnRef.current();
      if (curId === reqIdRef.current) {
        setRawData(result);
        setError(null);
        return result;
      }
      return null;
    } catch (e: unknown) {
      if (curId === reqIdRef.current) {
        setError(e instanceof Error ? e.message : String(e));
      }
      return null;
    } finally {
      if (curId === reqIdRef.current) {
        if (isInitial) setLoading(false);
        else setReloading(false);
      }
    }
  }, []);

  useEffect(() => {
    // 如果之前已有数据，在依赖改变时做后台静默加载；首次加载则 loading=true
    execute(data === null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const refetch = useCallback(() => execute(false), [execute]);

  return { data, loading, reloading, error, refetch, setData };
}