import { useState, useEffect } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  DocumentTextIcon,
  MagnifyingGlassIcon,
  Squares2X2Icon,
  CalendarDaysIcon,
  ClipboardDocumentListIcon,
  ChevronDoubleLeftIcon,
  ChevronDoubleRightIcon,
  ArrowRightOnRectangleIcon,
  ArrowLeftOnRectangleIcon,
  Bars3Icon,
  XMarkIcon,
  InboxIcon,
  DocumentChartBarIcon,
  Cog6ToothIcon,
  CalendarIcon,
} from "@heroicons/react/24/outline";
import { ProjectNotice, useProjects } from "../projects";
import { useAuth } from "../auth";
import { api, useAsync } from "../api";

const STORAGE_KEY = "worknote_sidebar_collapsed";

export function Layout({ children }: { children: React.ReactNode }) {
  const { authed, logout } = useAuth();
  const { projects } = useProjects();
  const navigate = useNavigate();
  const location = useLocation();
  const pathname = location.pathname;

  const [q, setQ] = useState("");
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === "true";
    } catch {
      return false;
    }
  });
  const [mobileOpen, setMobileOpen] = useState(false);

  // 收件箱未整理数(侧边栏徽标;未登录不拉取)
  const inbox = useAsync(() => (authed ? api.inbox() : Promise.resolve(null)), [authed]);
  const inboxCount = inbox.data?.count ?? 0;

  // 路由跳转时自动关闭移动端抽屉
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, String(next));
      } catch {}
      return next;
    });
  }

  function submitSearch(e: React.FormEvent) {
    e.preventDefault();
    const next = q.trim();
    if (next) navigate(`/search?q=${encodeURIComponent(next)}`);
    else navigate("/search");
  }

  // 首页、待办页与全部记录时间轴支持自适应更宽视口
  const wide = pathname === "/" || pathname === "/todo" || pathname === "/records";
  const wrap = wide ? "max-w-[1280px]" : "max-w-[960px]";

  type NavItem = {
    to: string;
    label: string;
    icon: typeof Squares2X2Icon;
    end: boolean;
    badge?: number;
  };
  const mainNavs: NavItem[] = [
    { to: "/", label: "总览", icon: Squares2X2Icon, end: true },
    ...(authed
      ? [
          { to: "/records", label: "全部记录", icon: CalendarDaysIcon, end: false },
          { to: "/todo", label: "待办", icon: ClipboardDocumentListIcon, end: false },
          { to: "/inbox", label: "收件箱", icon: InboxIcon, end: false, badge: inboxCount },
          { to: "/calendar", label: "日历排期", icon: CalendarIcon, end: false },
          { to: "/report", label: "汇报", icon: DocumentChartBarIcon, end: false },
          { to: "/settings", label: "设置", icon: Cog6ToothIcon, end: false },
        ]
      : []),
  ];

  const projectItems = projects.map(({ slug, name }) => ({
    to: `/projects/${encodeURIComponent(slug)}`,
    name,
    badge: (name || slug).slice(0, 1),
  }));

  return (
    <div className="flex min-h-screen bg-canvas text-ink">
      {/* 桌面端左侧边栏 (md 及以上) */}
      <aside
        className={`sticky top-0 z-30 hidden h-screen flex-col border-r border-line bg-surface transition-[width] duration-200 ease-in-out md:flex ${
          collapsed ? "w-[68px]" : "w-64"
        }`}
      >
        {/* 顶部 Logo 与折叠按钮 */}
        <div className="flex h-14 items-center justify-between border-b border-line px-3.5">
          <NavLink
            to="/"
            title="工作记录"
            className="flex items-center gap-2.5 overflow-hidden text-[15px] font-semibold tracking-[-0.1px] text-ink hover:no-underline"
          >
            <div className="flex h-8 w-8 flex-none items-center justify-center rounded-lg bg-accent-tint text-accent">
              <DocumentTextIcon className="h-5 w-5" />
            </div>
            {!collapsed && <span className="truncate">工作记录</span>}
          </NavLink>

          {!collapsed && (
            <button
              type="button"
              onClick={toggleCollapsed}
              title="折叠菜单"
              className="rounded p-1 text-ink-muted transition hover:bg-line-soft hover:text-ink"
            >
              <ChevronDoubleLeftIcon className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* 搜索框 (展开态为完整输入框，折叠态为图标快捷按钮) */}
        {authed && (
          <div className="border-b border-line-soft p-2.5">
            {collapsed ? (
              <button
                type="button"
                onClick={() => navigate("/search")}
                title="搜索工作记录…"
                className="flex h-9 w-full items-center justify-center rounded-md text-ink-muted transition hover:bg-line-soft hover:text-ink"
              >
                <MagnifyingGlassIcon className="h-4 w-4" />
              </button>
            ) : (
              <form onSubmit={submitSearch} className="relative">
                <MagnifyingGlassIcon className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="搜索记录…"
                  className="w-full rounded-md border border-line bg-surface-2 py-1.5 pl-8 pr-2.5 text-[12.5px] text-ink outline-none transition focus:border-accent"
                />
              </form>
            )}
          </div>
        )}

        {/* 导航列表区 */}
        <div className="flex-1 overflow-y-auto px-2 py-3">
          {/* 主功能导航 */}
          <div className="space-y-1">
            {mainNavs.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  title={collapsed ? item.label : undefined}
                  className={({ isActive }) =>
                    `flex items-center gap-3 rounded-md px-2.5 py-2 text-[13.5px] transition-colors ${
                      isActive
                        ? "bg-accent-tint font-medium text-accent hover:no-underline"
                        : "text-ink-2 hover:bg-line-soft hover:text-ink hover:no-underline"
                    } ${collapsed ? "justify-center px-0" : ""}`
                  }
                >
                  <Icon className="h-[18px] w-[18px] flex-none" />
                  {!collapsed && <span className="truncate">{item.label}</span>}
                  {!collapsed && !!item.badge && (
                    <span className="ml-auto rounded-full bg-accent px-1.5 text-[11px] font-medium leading-[17px] text-white">
                      {item.badge}
                    </span>
                  )}
                </NavLink>
              );
            })}
          </div>

          {/* 项目专区 */}
          {authed && (
            <div className="mt-5 border-t border-line-soft pt-4">
              {!collapsed && (
                <div className="mb-2 px-2.5 text-[11px] font-semibold uppercase tracking-[0.5px] text-ink-muted">
                  项目列表
                </div>
              )}
              <div className="space-y-1">
                <div className={collapsed ? "" : "px-2.5"}><ProjectNotice compact={collapsed} /></div>
                {projectItems.map((p) => (
                  <NavLink
                    key={p.to}
                    to={p.to}
                    title={collapsed ? p.name : undefined}
                    className={({ isActive }) =>
                      `flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] transition-colors ${
                        isActive
                          ? "bg-accent-tint font-medium text-accent hover:no-underline"
                          : "text-ink-2 hover:bg-line-soft hover:text-ink hover:no-underline"
                      } ${collapsed ? "justify-center px-0" : ""}`
                    }
                  >
                    <span
                      className={`flex h-6 w-6 flex-none items-center justify-center rounded text-[11px] font-medium ${
                        collapsed
                          ? "border border-line bg-surface-2 text-ink"
                          : "bg-surface-2 text-ink-muted group-hover:text-ink"
                      }`}
                    >
                      {p.badge}
                    </span>
                    {!collapsed && <span className="truncate">{p.name}</span>}
                  </NavLink>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 侧边栏底部操作区 */}
        <div className="border-t border-line p-2">
          {authed ? (
            <button
              type="button"
              onClick={() => void logout()}
              title={collapsed ? "退出登录" : undefined}
              className={`flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-[13px] text-ink-muted transition hover:bg-line-soft hover:text-ink ${
                collapsed ? "justify-center px-0" : ""
              }`}
            >
              <ArrowRightOnRectangleIcon className="h-[18px] w-[18px] flex-none" />
              {!collapsed && <span>退出登录</span>}
            </button>
          ) : authed === false ? (
            <NavLink
              to="/login"
              title={collapsed ? "登录" : undefined}
              className={`flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-[13px] text-ink-muted transition hover:bg-line-soft hover:text-ink ${
                collapsed ? "justify-center px-0" : ""
              }`}
            >
              <ArrowLeftOnRectangleIcon className="h-[18px] w-[18px] flex-none" />
              {!collapsed && <span>登录</span>}
            </NavLink>
          ) : null}

          {/* 折叠态展开按钮 */}
          {collapsed && (
            <button
              type="button"
              onClick={toggleCollapsed}
              title="展开菜单"
              className="mt-1 flex h-8 w-full items-center justify-center rounded text-ink-muted transition hover:bg-line-soft hover:text-ink"
            >
              <ChevronDoubleRightIcon className="h-4 w-4" />
            </button>
          )}
        </div>
      </aside>

      {/* 移动端顶部轻量 Bar (md 以下) */}
      <div className="flex flex-1 flex-col min-w-0">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-line bg-surface px-4 md:hidden">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            aria-label="打开菜单"
            className="rounded p-1.5 text-ink-muted transition hover:bg-line-soft hover:text-ink"
          >
            <Bars3Icon className="h-5 w-5" />
          </button>

          <NavLink to="/" className="flex items-center gap-2 text-[15px] font-semibold text-ink">
            <DocumentTextIcon className="h-5 w-5 text-accent" />
            <span>工作记录</span>
          </NavLink>

          {authed ? (
            <button
              type="button"
              onClick={() => navigate("/search")}
              aria-label="搜索"
              className="rounded p-1.5 text-ink-muted transition hover:bg-line-soft hover:text-ink"
            >
              <MagnifyingGlassIcon className="h-5 w-5" />
            </button>
          ) : (
            <NavLink to="/login" className="text-[13px] text-accent">
              登录
            </NavLink>
          )}
        </header>

        {/* 移动端侧滑抽屉 */}
        {mobileOpen && (
          <div className="fixed inset-0 z-50 md:hidden">
            <div
              className="fixed inset-0 bg-black/40 backdrop-blur-xs transition-opacity"
              onClick={() => setMobileOpen(false)}
            />
            <div className="fixed inset-y-0 left-0 flex w-72 max-w-[80vw] flex-col border-r border-line bg-surface p-4 shadow-2xl">
              <div className="mb-4 flex items-center justify-between border-b border-line pb-3">
                <span className="flex items-center gap-2 font-semibold text-ink">
                  <DocumentTextIcon className="h-5 w-5 text-accent" />
                  工作记录
                </span>
                <button
                  type="button"
                  onClick={() => setMobileOpen(false)}
                  className="rounded p-1 text-ink-muted hover:text-ink"
                >
                  <XMarkIcon className="h-5 w-5" />
                </button>
              </div>

              {authed && (
                <form onSubmit={submitSearch} className="relative mb-3">
                  <MagnifyingGlassIcon className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
                  <input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="搜索记录…"
                    className="w-full rounded-md border border-line bg-surface-2 py-1.5 pl-8 pr-2.5 text-[13px] text-ink outline-none focus:border-accent"
                  />
                </form>
              )}

              <div className="flex-1 overflow-y-auto space-y-1">
                {mainNavs.map((item) => {
                  const Icon = item.icon;
                  return (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={item.end}
                      className={({ isActive }) =>
                        `flex items-center gap-3 rounded-md px-3 py-2 text-[14px] ${
                          isActive ? "bg-accent-tint font-medium text-accent" : "text-ink-2"
                        }`
                      }
                    >
                      <Icon className="h-5 w-5 flex-none" />
                      <span>{item.label}</span>
                      {!!item.badge && (
                        <span className="ml-auto rounded-full bg-accent px-1.5 text-[11px] font-medium leading-[17px] text-white">
                          {item.badge}
                        </span>
                      )}
                    </NavLink>
                  );
                })}

                {authed && (
                  <div className="mt-4 border-t border-line-soft pt-3">
                    <div className="mb-1.5 px-3 text-[11px] font-semibold uppercase text-ink-muted">
                      项目
                    </div>
                    <div className="px-3"><ProjectNotice /></div>
                    {projectItems.map((p) => (
                      <NavLink
                        key={p.to}
                        to={p.to}
                        className={({ isActive }) =>
                          `flex items-center gap-2.5 rounded-md px-3 py-1.5 text-[13.5px] ${
                            isActive ? "bg-accent-tint font-medium text-accent" : "text-ink-2"
                          }`
                        }
                      >
                        <span className="flex h-5 w-5 items-center justify-center rounded bg-surface-2 text-[11px] text-ink-muted">
                          {p.badge}
                        </span>
                        <span>{p.name}</span>
                      </NavLink>
                    ))}
                  </div>
                )}
              </div>

              <div className="border-t border-line pt-3">
                {authed ? (
                  <button
                    type="button"
                    onClick={() => void logout()}
                    className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-[13.5px] text-ink-muted"
                  >
                    <ArrowRightOnRectangleIcon className="h-5 w-5" />
                    <span>退出登录</span>
                  </button>
                ) : (
                  <NavLink
                    to="/login"
                    className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-[13.5px] text-accent"
                  >
                    <ArrowLeftOnRectangleIcon className="h-5 w-5" />
                    <span>登录</span>
                  </NavLink>
                )}
              </div>
            </div>
          </div>
        )}

        {/* 右侧主内容区 */}
        <main className={`mx-auto w-full ${wrap} flex-1 px-4 pb-[72px] sm:px-6 md:px-[22px]`}>
          {children}
        </main>

        {/* 页脚 */}
        <footer className={`mx-auto w-full ${wrap} px-4 sm:px-6 md:px-[22px]`}>
          <div className="flex flex-wrap justify-between gap-3 border-t border-line pt-[18px] text-[12.5px] text-ink-muted">
            <span>WorkNote · 工作内容记录</span>
            <span>React · Headless UI</span>
          </div>
        </footer>
      </div>
    </div>
  );
}

/** 页面标题区。 */
export function PageHead({
  title,
  subtitle,
  crumbs,
}: {
  title: React.ReactNode;
  subtitle?: string;
  crumbs?: React.ReactNode;
}) {
  return (
    <div className="pt-8 md:pt-10">
      {crumbs && <p className="mb-2 text-[13px] text-ink-muted">{crumbs}</p>}
      <h1 className="m-0 mb-1.5 text-[22px] font-semibold tracking-[-0.3px] md:text-[24px]">
        {title}
      </h1>
      {subtitle && <p className="m-0 text-[13px] text-ink-muted md:text-[13.5px]">{subtitle}</p>}
    </div>
  );
}
