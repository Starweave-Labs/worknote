/**
 * 收件箱页:先存后整理的快速捕获区。
 *
 * 顶部随手记(文字 + Ctrl+V 粘贴截图),落进 inbox.md;
 * 列表展示未整理条目,点击图片进灯箱;整理完成后删除
 * (归档为正式记录由助手完成,见 AGENTS.md「收件箱」一节)。
 */
import { useEffect, useState } from "react";
import { api, useAsync } from "../api";
import { PageHead } from "../components/Layout";
import { Placeholder } from "../components/Metabox";
import { RichTextarea, useImagePicker } from "../components/ImagePicker";
import { Lightbox, type LightboxImage } from "../components/Lightbox";

export function InboxPage() {
  const { data, loading, error, refetch } = useAsync(() => api.inbox(), []);
  const [text, setText] = useState("");
  const picker = useImagePicker();
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<LightboxImage | null>(null);

  // 系统分享入口(安卓 App「分享到 WorkNote」):sw.js 把文字与截图暂存 Cache,
  // 这里取走填入表单并清理,随后清掉 ?shared=1。
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("shared") !== "1") return;
    (async () => {
      if (!("caches" in window)) return;
      const names = (await caches.keys()).filter((n) => n.startsWith("share-target-"));
      for (const name of names) {
        try {
          const cache = await caches.open(name);
          const metaRes = await cache.match("meta");
          const countRes = await cache.match("count");
          if (!metaRes || !countRes) continue;
          const meta = (await metaRes.json()) as { title?: string; text?: string };
          const count = Number(await countRes.text()) || 0;
          const shared = [meta.text, meta.title].filter(Boolean).join("\n").trim();
          if (shared) setText((t) => (t ? `${t}\n${shared}` : shared));
          const files: File[] = [];
          for (let i = 0; i < count; i++) {
            const res = await cache.match(`img-${i}`);
            if (!res) continue;
            const blob = await res.blob();
            files.push(new File([blob], `分享截图${i + 1}.png`, { type: blob.type || "image/png" }));
          }
          if (files.length) await picker.addFiles(files);
        } finally {
          await caches.delete(name);
        }
      }
      window.history.replaceState({}, "", "/inbox");
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    if (!text.trim() && !picker.images.length) {
      setSaveErr("写点什么,或粘贴一张截图");
      return;
    }
    setSaving(true);
    setSaveErr(null);
    try {
      await api.addInbox(text, picker.images.map((im) => ({ dataUrl: im.dataUrl, alt: im.name })));
      setText("");
      picker.clear();
      await refetch();
    } catch (err) {
      setSaveErr(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    if (!window.confirm("确认删除这条收件箱内容?(归档后也应删除,未归档请先记录下来)")) return;
    try {
      await api.removeInbox(id);
      await refetch();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <>
      <PageHead
        title="收件箱"
        subtitle="随手记:文字与截图先存进来,稍后由助手整理归档为正式记录"
      />

      <form onSubmit={submit} className="mt-5 max-w-[720px] rounded-md border border-line bg-surface p-4">
        <RichTextarea
          picker={picker}
          value={text}
          onChange={setText}
          rows={3}
          placeholder="想到什么记什么…(Ctrl+V 可直接粘贴截图)"
          autoFocus
        />
        <div className="mt-3 flex items-center justify-between gap-3">
          <span className="text-[12px] text-ink-muted">整理时会自动进入对应项目的当日记录</span>
          <button
            type="submit"
            disabled={saving}
            className="btn-primary"
          >
            {saving ? "保存中…" : "记一笔"}
          </button>
        </div>
        {saveErr && <p className="mt-2 text-[12.5px] text-t3">{saveErr}</p>}
      </form>

      <h2 className="section-title mt-8">
        未整理 {data?.count ?? "…"} 条
      </h2>
      {loading && <Placeholder kind="loading" text="加载中..." />}
      {error && <Placeholder kind="error" text={`加载失败:${error}`} />}
      {data && !data.items.length && !loading && (
        <Placeholder kind="empty" text="收件箱是空的——有临时的想法或截图,先丢进来" />
      )}

      <div className="space-y-3">
        {data?.items.map((it) => (
          <article key={it.id} className="rounded-md border border-line bg-surface p-4">
            <div className="flex items-center justify-between gap-3">
              <time className="text-[12.5px] tabular-nums text-ink-muted">{it.at}</time>
              <button
                type="button"
                onClick={() => void remove(it.id)}
                className="rounded border border-line px-2 py-0.5 text-[12px] text-ink-muted transition hover:border-t3 hover:text-t3"
              >
                删除
              </button>
            </div>
            {it.text && (
              <p className="mb-0 mt-2 whitespace-pre-wrap text-[14px] leading-[1.8] text-ink">{it.text}</p>
            )}
            {!!it.images.length && (
              <div className="mt-3 flex flex-wrap gap-2">
                {it.images.map((im, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() =>
                      setLightbox({ url: im.url, alt: im.alt, thumbUrl: `${im.url}?thumb=1` })
                    }
                    className="img-cell m-0 border-0 bg-transparent p-0"
                  >
                    <img
                      src={`${im.url}?thumb=1`}
                      alt={im.alt}
                      className="h-[86px] w-[86px] rounded-md border border-line object-cover"
                    />
                  </button>
                ))}
              </div>
            )}
          </article>
        ))}
      </div>

      <Lightbox image={lightbox} onClose={() => setLightbox(null)} />
    </>
  );
}
