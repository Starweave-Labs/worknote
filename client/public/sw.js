/**
 * WorkNote Service Worker —— 最小透传 + 系统分享入口(share target)。
 *
 * 页面请求全部透传(站点数据必须实时);唯一拦截:安卓「分享到 WorkNote」
 * 发来的 POST /share-target——把分享的文字与截图暂存进 Cache Storage,
 * 重定向到 /inbox?shared=1,由页面取走后填入「记一笔」表单并清理缓存。
 */

const SHARED_PREFIX = "share-target-";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method === "POST" && url.pathname === "/share-target") {
    event.respondWith(Response.redirect("/inbox?shared=1", 303));
    event.waitUntil(handleShare(event.request));
  }
});

async function handleShare(request) {
  try {
    const data = await request.formData();
    const cache = await caches.open(SHARED_PREFIX + Date.now());
    const meta = {
      title: String(data.get("title") || ""),
      text: String(data.get("text") || ""),
    };
    await cache.put(
      "meta",
      new Response(JSON.stringify(meta), { headers: { "Content-Type": "application/json" } }),
    );
    let i = 0;
    for (const [, v] of data.entries()) {
      if (i >= 6) break;
      if (v && typeof v === "object" && typeof v.arrayBuffer === "function" && v.size > 0) {
        const buf = await v.arrayBuffer();
        if (buf.byteLength > 8 * 1024 * 1024) continue; // 与站点上限一致
        await cache.put(
          "img-" + i,
          new Response(buf, { headers: { "Content-Type": v.type || "image/png" } }),
        );
        i += 1;
      }
    }
    await cache.put("count", new Response(String(i)));
  } catch (e) {
    console.error("share target 处理失败", e);
  }
}
