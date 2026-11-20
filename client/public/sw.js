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
    event.respondWith(handleShare(event.request));
  }
});

async function handleShare(request) {
  let cacheName;
  try {
    const data = await request.formData();
    cacheName = SHARED_PREFIX + Date.now() + "-" + crypto.randomUUID();
    const cache = await caches.open(cacheName);
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
    // count 最后写入,作为完整缓存的就绪标记;全部成功后才允许页面读取。
    await cache.put("count", new Response(String(i)));
    return Response.redirect(new URL("/inbox?shared=1", request.url).href, 303);
  } catch (e) {
    if (cacheName) {
      try {
        await caches.delete(cacheName);
      } catch (cleanupError) {
        console.error("share target 清理失败", cleanupError);
      }
    }
    console.error("share target 处理失败", e);
    return new Response("分享失败，内容未保存。请返回后重试。", {
      status: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}
