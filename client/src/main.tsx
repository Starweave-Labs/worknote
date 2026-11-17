import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useParams } from "react-router-dom";
import { useEffect } from "react";
import "./index.css";
import { Layout } from "./components/Layout";
import { OverviewPage } from "./pages/OverviewPage";
import { TodoPage } from "./pages/TodoPage";
import { ProjectPage } from "./pages/ProjectPage";
import { DayPage } from "./pages/DayPage";
import { LoginPage } from "./pages/LoginPage";
import { RecordsPage } from "./pages/RecordsPage";
import { SearchPage } from "./pages/SearchPage";
import { SharePage } from "./pages/SharePage";
import { InboxPage } from "./pages/InboxPage";
import { ReportPage } from "./pages/ReportPage";
import { SettingsPage } from "./pages/SettingsPage";
import { CalendarPage } from "./pages/CalendarPage";
import { AuthProvider, useAuth, setLoginRedirect } from "./auth";
import { ProjectProvider } from "./projects";
import { Placeholder } from "./components/Metabox";

/** 受保护页面:未登录时引导去登录页。 */
function Protected({ children }: { children: React.ReactNode }) {
  const { authed } = useAuth();
  if (authed === null) return <Placeholder kind="loading" text="加载中..." />;
  if (!authed) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

/** 把 401 的跳转意图接到 router 上。 */
function LoginRedirectBridge() {
  const navigate = useNavigate();
  useEffect(() => {
    setLoginRedirect(() => navigate("/login"));
    return () => setLoginRedirect(null);
  }, [navigate]);
  return null;
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ProjectProvider>
          <LoginRedirectBridge />
          <Layout>
          <Routes>
            <Route path="/" element={<OverviewPage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/share/:token" element={<SharePageWrapper />} />
            <Route
              path="/todo"
              element={
                <Protected>
                  <TodoPage />
                </Protected>
              }
            />
            <Route
              path="/records"
              element={
                <Protected>
                  <RecordsPage />
                </Protected>
              }
            />
            <Route
              path="/search"
              element={
                <Protected>
                  <SearchPage />
                </Protected>
              }
            />
            <Route
              path="/inbox"
              element={
                <Protected>
                  <InboxPage />
                </Protected>
              }
            />
            <Route
              path="/report"
              element={
                <Protected>
                  <ReportPage />
                </Protected>
              }
            />
            <Route
              path="/settings"
              element={
                <Protected>
                  <SettingsPage />
                </Protected>
              }
            />
            <Route
              path="/calendar"
              element={
                <Protected>
                  <CalendarPage />
                </Protected>
              }
            />
            <Route
              path="/projects/:slug"
              element={
                <Protected>
                  <ProjectPage />
                </Protected>
              }
            />
            <Route
              path="/days/:slug/:date"
              element={
                <Protected>
                  <DayPage />
                </Protected>
              }
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          </Layout>
        </ProjectProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}

function SharePageWrapper() {
  const { token = "" } = useParams();
  return <SharePage token={token} />;
}

createRoot(document.getElementById("root")!).render(<App />);

// 注册 Service Worker(系统分享 share-target 入口依赖它;失败静默,不影响站点)
if ("serviceWorker" in navigator && location.protocol === "https:") {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* 注册失败仅影响分享入口,站点功能不受影响 */
    });
  });
}