export interface PaginationProps {
  offset: number;
  limit: number;
  total: number;
  onChange: (offset: number) => void;
  className?: string;
}

export function Pagination({
  offset,
  limit,
  total,
  onChange,
  className = "",
}: PaginationProps) {
  if (total <= limit) return null;

  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + limit, total);
  const hasPrev = offset > 0;
  const hasNext = offset + limit < total;

  return (
    <div
      className={`mt-5 flex items-center justify-between border-t border-line-soft pt-3.5 text-[13px] ${className}`}
    >
      <button
        type="button"
        disabled={!hasPrev}
        onClick={() => onChange(Math.max(0, offset - limit))}
        className="rounded-md border border-line px-2.5 py-1 text-ink-2 transition hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
      >
        ← 上一页
      </button>
      <span className="text-[12px] text-ink-muted">
        {from}–{to} / {total}
      </span>
      <button
        type="button"
        disabled={!hasNext}
        onClick={() => onChange(offset + limit)}
        className="rounded-md border border-line px-2.5 py-1 text-ink-2 transition hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
      >
        下一页 →
      </button>
    </div>
  );
}
