/** 类型标签:单色梯度色点 + 文字。 */
import { TYPE_ORDER } from "../constants";

const DOT = ["bg-t1", "bg-t2", "bg-t3", "bg-t4"];
const ORDER = TYPE_ORDER as readonly string[];

export function typeDotIndex(type: string): number {
  return ORDER.indexOf(type);
}

export function TypeTag({ type }: { type: string }) {
  if (!type) return null;
  const i = typeDotIndex(type);
  return (
    <span className="tag text-[11.5px] text-ink-2">
      {i >= 0 && (
        <span className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-sm align-[1px] ${DOT[i]}`} />
      )}
      {type}
    </span>
  );
}

/** 优先级标签:遵从一个主色+中性灰阶规范。 */
export function PriorityTag({ priority }: { priority?: string }) {
  if (!priority) return null;
  if (priority === "高") {
    return (
      <span className="tag font-medium border-accent bg-accent text-white">
        高优
      </span>
    );
  }
  if (priority === "中") {
    return (
      <span className="tag font-medium border-t3/50 bg-accent-tint text-accent">
        中优
      </span>
    );
  }
  if (priority === "低") {
    return (
      <span className="tag border-line bg-surface-2 text-ink-muted">
        低优
      </span>
    );
  }
  return (
    <span className="tag border-line bg-surface-2 text-ink-muted">
      {priority}
    </span>
  );
}

/** 模块标签:无圆点,更安静。 */
export function ModuleTag({ module }: { module: string }) {
  if (!module) return null;
  return <span className="whitespace-nowrap text-[12px] text-ink-muted">{module}</span>;
}

/** 本地今天 YYYY-MM-DD。 */
function localToday(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 把 YYYY-MM-DD 显示为 M-D(如 10-30)。 */
function shortDate(due: string): string {
  return due.slice(5);
}

/**
 * 预计完成标签(仅未完成条目使用):
 * - 逾期(due < 今天):红底白字实底,全站视觉权重最高;
 * - 今天到期:红字红框浅底;
 * - 未来:中性灰底。
 * 无 due 或已完成不渲染(逾期语义对已完成项无意义)。
 */
export function DueTag({ due, done }: { due?: string; done?: boolean }) {
  if (!due || done) return null;
  const today = localToday();
  if (due < today) {
    return (
      <span
        title={`预计完成 ${due},已逾期`}
        className="tag font-medium border-danger bg-danger text-white"
      >
        逾期{shortDate(due)}
      </span>
    );
  }
  if (due === today) {
    return (
      <span
        title={`预计完成 ${due},今天到期`}
        className="tag font-medium border-danger/50 bg-danger-tint text-danger"
      >
        今天到期
      </span>
    );
  }
  return (
    <span
      title={`预计完成 ${due}`}
      className="tag border-line bg-surface-2 text-ink-2"
    >
      {shortDate(due)}
    </span>
  );
}

/** 行内类型统计:数值 + 名称 + 色点。 */
export function TypePills({ counts }: { counts: Record<string, number> }) {
  const items = TYPE_ORDER.filter((t) => counts[t]);
  if (!items.length) return null;
  return (
    <div className="flex flex-wrap items-baseline gap-x-[18px] gap-y-1">
      {items.map((t) => (
        <span key={t} className="inline-flex items-baseline gap-[7px] text-[13px] text-ink-2">
          <span
            className={`inline-block h-2 w-2 self-center rounded-sm ${DOT[TYPE_ORDER.indexOf(t)]}`}
          />
          <b className="font-semibold tabular-nums text-ink">{counts[t]}</b>
          <span className="text-ink-muted">{t}</span>
        </span>
      ))}
    </div>
  );
}

/** 分布条 + 图例(同一套色点,不重复信息)。 */
export function DistBar({ counts }: { counts: Record<string, number> }) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (!total) return null;
  const items = TYPE_ORDER.filter((t) => counts[t]);
  return (
    <>
      <div className="mb-3.5 flex h-2 overflow-hidden rounded bg-line-soft">
        {items.map((t) => (
          <span
            key={t}
            title={`${t} ${counts[t]}`}
            className={DOT[TYPE_ORDER.indexOf(t)]}
            style={{ width: `${(counts[t] * 100) / total}%` }}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-1">
        {TYPE_ORDER.map((t) => (
          <span key={t} className="inline-flex items-baseline gap-[7px] text-[13px] text-ink-muted">
            <span
              className={`inline-block h-2 w-2 self-center rounded-sm ${DOT[TYPE_ORDER.indexOf(t)]}`}
            />
            {t} <b className="font-semibold tabular-nums text-ink">{counts[t] ?? 0}</b>
          </span>
        ))}
      </div>
    </>
  );
}