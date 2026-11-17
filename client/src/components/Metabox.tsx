/** 概览条:一行紧凑的「标签 + 数值」,替代大号统计卡。 */
export interface MetaboxItem {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
}

export function Metabox({ items }: { items: MetaboxItem[] }) {
  return (
    <div className="metabar mt-[22px]">
      {items.map((it, i) => (
        <div key={i} className="metabar-cell min-w-[108px]">
          <div className="text-[12px] font-medium tracking-[0.3px] text-ink-muted">{it.label}</div>
          <div className="text-[21px] font-semibold leading-[1.25] tracking-[-0.4px] tabular-nums">
            {it.value}
          </div>
          {it.sub && <div className="text-[12px] text-ink-2">{it.sub}</div>}
        </div>
      ))}
    </div>
  );
}

/** 空状态 / 加载 / 错误。 */
export function Placeholder({ kind, text }: { kind: "loading" | "error" | "empty"; text: string }) {
  const tone = kind === "error" ? "text-t3" : "text-ink-2";
  return <p className={`py-5 text-[13.5px] ${tone}`}>{text}</p>;
}