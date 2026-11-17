import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "WORKNOTE_");
  const apiUrl = process.env.WORKNOTE_API_URL || env.WORKNOTE_API_URL || "http://127.0.0.1:8000";
  const proxy = {
    "/api": apiUrl,
    "/attachments": apiUrl,
  };

  return {
    plugins: [react()],
    build: {
      // 仅输出到当前仓库的 public/app，由静态服务器托管。
      outDir: "../public/app",
      emptyOutDir: true,
    },
    server: {
      port: 5173,
      proxy,
    },
    preview: {
      host: "127.0.0.1",
      port: 4173,
      proxy,
    },
  };
});
