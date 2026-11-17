/**
 * 登录状态:启动时拉一次 /api/me,并把 401 交给路由跳登录。
 */

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api, setUnauthorizedHandler } from "./api";

interface AuthState {
  /** null = 还没确认(启动中)。 */
  authed: boolean | null;
  /** 后端是否配置了登录口令。 */
  configured: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthState>({
  authed: null,
  configured: true,
  refresh: async () => {},
  logout: async () => {},
});

export function useAuth() {
  return useContext(Ctx);
}

/** 登录跳转由 main.tsx 注入,避免这里直接依赖 router。 */
let goLogin: (() => void) | null = null;
export function setLoginRedirect(fn: (() => void) | null) {
  goLogin = fn;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [configured, setConfigured] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const me = await api.me();
      setAuthed(me.authed);
      setConfigured(me.configured);
    } catch {
      setAuthed(false);
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      setAuthed(false);
    }
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setAuthed(false);
      goLogin?.();
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return <Ctx.Provider value={{ authed, configured, refresh, logout }}>{children}</Ctx.Provider>;
}