import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, useAsync } from "../api";
import { PageHead } from "../components/Layout";
import { Metabox, Placeholder } from "../components/Metabox";
import { TypePills, TypeTag, ModuleTag } from "../components/Tags";
import { Lightbox, type LightboxImage } from "../components/Lightbox";
import { ThumbImage, toThumbUrl, toOriginalUrl } from "../components/ThumbImage";
import { TYPE_ORDER } from "../constants";
import type { Block } from "../types";

const DOT = ["bg-t1", "bg-t2", "bg-t3", "bg-t4"];
const ORD = TYPE_ORDER as readonly string[];

/** 字段块:跳过已展示在头部的字段;附件块渲染为图片网格。 */
function FieldBlock({ block, onZoom }: { block: Block; onZoom: (img: LightboxImage) => void }) {
  if (block.field === "类型" || block.field === "模块") return null;

  if (block.field === "附件") {
    if (!block.imageUrls.length) return null;
    return (
      <div className="grid grid-cols-[62px_1fr] gap-4 border-t border-line-soft py-3.5 max-sm:grid-cols-1 max-sm:gap-y-0.5">
        <dt className="text-[12.5px] text-ink-muted">附件</dt>
        <dd className="m-0 min-w-0">
          <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3 max-sm:grid-cols-[repeat(auto-fill,minmax(140px,1fr))]">
            {block.imageUrls.map((im) => {
              const fullUrl = toOriginalUrl(im.url);
              const thumbUrl = toThumbUrl(im.url);
              return (
                <figure key={im.url} className="m-0">
                  <button
                    type="button"
                    onClick={() => onZoom({ url: fullUrl, thumbUrl, alt: im.alt })}
                    className="img-cell group relative block h-[138px] w-full cursor-pointer overflow-hidden rounded-md border border-line p-0 max-sm:h-[104px]"
                    aria-label={`放大查看:${im.alt}`}
                  >
                    <ThumbImage
                      src={thumbUrl}
                      alt={im.alt}
                      className="h-full w-full object-cover object-top"
                    />
                    <span className="pointer-events-none absolute bottom-2 right-2 rounded bg-[rgba(20,24,29,0.72)] px-2 py-0.5 text-[11px] text-white opacity-0 transition-opacity group-hover:opacity-100">
                      点击放大
                    </span>
                  </button>
                  <figcaption className="mt-1.5 text-[12px] text-ink-muted">{im.alt}</figcaption>
                </figure>
              );
            })}
          </div>
        </dd>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-[62px_1fr] gap-4 border-t border-line-soft py-3 first:border-t-0 first:pt-0 max-sm:grid-cols-1 max-sm:gap-y-0.5">
      <dt className="pt-px text-[12.5px] text-ink-muted">{block.field}</dt>
      <dd
        className="m-0 min-w-0 leading-[1.75] [&_blockquote]:my-0 [&_blockquote]:mb-3 [&_blockquote]:border-l-2 [&_blockquote]:border-line [&_blockquote]:py-2 [&_blockquote]:pl-4 [&_blockquote]:text-[14px] [&_blockquote]:text-ink-2 [&_code]:rounded [&_code]:bg-line-soft [&_code]:px-1.5 [&_code]:py-px [&_code]:text-[12.5px] [&_li]:my-[3px] [&_p]:m-0 [&_p]:mb-1.5 [&_p:last-child]:mb-0 [&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:border [&_pre]:border-line [&_pre]:bg-surface-2 [&_pre]:p-3.5 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_ul]:m-0 [&_ul]:mt-1 [&_ul]:pl-[18px]"
        dangerouslySetInnerHTML={{ __html: block.html }}
      />
    </div>
  );
}

export function DayPage() {
  const { slug = "", date = "" } = useParams();
  const { data, loading, error } = useAsync(() => api.day(slug, date), [slug, date]);
  const [zoom, setZoom] = useState<LightboxImage | null>(null);

  // 支持从总览页带 #anchor 直接跳转到某条记录
  useEffect(() => {
    if (!data) return;
    const hash = decodeURIComponent(window.location.hash.slice(1));
    if (hash) {
      const el = document.getElementById(hash);
      if (el) el.scrollIntoView({ block: "start" });
    }
  }, [data]);

  if (loading) return <Placeholder kind="loading" text="加载中…" />;
  if (error) return <Placeholder kind="error" text={`加载失败:${error}`} />;
  if (!data) return null;

  return (
    <>
      <PageHead
        title={
          <>
            {data.date}
            <span className="ml-2 text-[14px] font-normal text-ink-muted">星期{data.weekday}</span>
          </>
        }
        crumbs={
          <>
            <Link to={`/projects/${data.projectSlug}`} className="text-ink-muted hover:text-accent">
              {data.projectName}
            </Link>{" "}
            / 工作记录
          </>
        }
        subtitle={data.meta.system ? `系统:${data.meta.system}` : undefined}
      />

      <Metabox
        items={[
          {
            label: "今日事项",
            value: (
              <>
                {data.entries.length}
                <span className="ml-0.5 text-[12.5px] font-normal text-ink-muted">条</span>
              </>
            ),
            sub: `覆盖 ${new Set(data.entries.map((e) => e.module).filter(Boolean)).size} 个模块`,
          },
          { label: "事项类型", value: "\u00a0", sub: <TypePills counts={data.counts} /> },
        ]}
      />

      {data.meta.summary && (
        <div className="mt-6 border-l-2 border-accent py-0.5 pl-4">
          <div className="mb-1 text-[11.5px] font-semibold uppercase tracking-[0.6px] text-ink-muted">
            当日概要
          </div>
          <p className="m-0 text-[14px] leading-[1.7] text-ink-2">{data.meta.summary}</p>
        </div>
      )}

      {data.entries.length > 1 && (
        <div className="mt-[30px] flex flex-wrap gap-2">
          {data.entries.map((e) => (
            <a
              key={e.anchor}
              href={`#${e.anchor}`}
              onClick={(ev) => {
                ev.preventDefault();
                document.getElementById(e.anchor)?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
              className="inline-flex items-baseline gap-2 rounded-full border border-line bg-surface px-3 py-[5px] text-[12.5px] text-ink-2 transition-colors hover:border-accent hover:text-accent hover:no-underline"
            >
              <span className="text-[12px] tabular-nums text-ink-muted">{e.time}</span>
              <span className="max-w-[260px] truncate max-sm:max-w-[150px]">{e.title}</span>
              {ORD.includes(e.type) && (
                <span
                  className={`inline-block h-1.5 w-1.5 self-center rounded-sm ${DOT[ORD.indexOf(e.type)]}`}
                />
              )}
            </a>
          ))}
        </div>
      )}

      {data.entries.map((e) => (
        <section
          key={e.anchor}
          id={e.anchor}
          className="my-3.5 rounded-card border border-line bg-surface p-[22px] px-6 target:border-accent max-sm:px-[18px]"
        >
          <div className="mb-1">
            <div className="flex flex-wrap items-baseline gap-2.5">
              <span className="flex-none text-[12.5px] font-semibold tabular-nums text-ink-muted">
                {e.time}
              </span>
              <h3 className="m-0 text-[16px] font-semibold tracking-[-0.1px]">{e.title}</h3>
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-2">
              <TypeTag type={e.type} />
              <ModuleTag module={e.module} />
            </div>
          </div>
          <dl className="mt-4">
            {e.blocks.map((b, i) => (
              <FieldBlock key={`${b.field}-${i}`} block={b} onZoom={setZoom} />
            ))}
          </dl>
        </section>
      ))}

      <div className="mt-9 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5 text-[13.5px]">
        <Link to={`/projects/${data.projectSlug}`} className="text-ink-muted hover:text-accent hover:no-underline">
          ← {data.projectName}
        </Link>
        <div className="flex items-center gap-4">
          {data.prev ? (
            <Link
              to={`/days/${data.projectSlug}/${data.prev}`}
              className="text-ink-muted hover:text-accent hover:no-underline"
            >
              ← 上一天 {data.prev}
            </Link>
          ) : (
            <span className="text-ink-muted opacity-40">← 上一天</span>
          )}
          {data.next ? (
            <Link
              to={`/days/${data.projectSlug}/${data.next}`}
              className="text-ink-muted hover:text-accent hover:no-underline"
            >
              下一天 {data.next} →
            </Link>
          ) : (
            <span className="text-ink-muted opacity-40">下一天 →</span>
          )}
        </div>
      </div>

      <Lightbox image={zoom} onClose={() => setZoom(null)} />
    </>
  );
}