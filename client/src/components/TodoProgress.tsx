import { useEffect, useId, useRef, useState } from "react";

interface Props {
  value: number;
  label?: string;
  readOnly?: boolean;
  disabled?: boolean;
  /** 松开指针/方向键或确认数值时提交;表单可仅更新本地值。 */
  onCommit?: (progress: number) => Promise<void> | void;
  showInput?: boolean;
  className?: string;
}

const RANGE_KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"]);
const normalize = (value: number) => Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : 0;

/** 待办进度:原生 range 保留触控、键盘与辅助技术语义,只在一次操作结束后保存。 */
export function TodoProgress({ value, label = "完成进度", readOnly, disabled, onCommit, showInput, className = "" }: Props) {
  const current = normalize(value);
  const [draft, setDraft] = useState(current);
  const [numberText, setNumberText] = useState(String(current));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valueRef = useRef(current);
  const draftRef = useRef(current);
  const pending = useRef(false);
  const pointer = useRef<number | null>(null);
  const keyboard = useRef(false);
  const cancelled = useRef(false);
  const rangeRef = useRef<HTMLInputElement | null>(null);
  const mounted = useRef(true);
  const id = useId();
  valueRef.current = current;
  const editable = !readOnly && !!onCommit;
  const locked = disabled || busy;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    if (!pending.current && pointer.current === null && !keyboard.current) {
      draftRef.current = current;
      setDraft(current);
      setNumberText(String(current));
    }
  }, [current, busy]);

  useEffect(() => {
    const onWindowBlur = () => cancel();
    window.addEventListener("blur", onWindowBlur);
    return () => window.removeEventListener("blur", onWindowBlur);
  }, []);

  useEffect(() => {
    if (disabled || readOnly) cancel();
  }, [disabled, readOnly]);

  function preview(next: number) {
    draftRef.current = next;
    setDraft(next);
    setNumberText(String(next));
    setError(null);
  }

  function releasePointer() {
    const pointerId = pointer.current;
    pointer.current = null;
    if (pointerId !== null && rangeRef.current?.hasPointerCapture(pointerId)) {
      rangeRef.current.releasePointerCapture(pointerId);
    }
  }

  function cancel() {
    cancelled.current = true;
    keyboard.current = false;
    releasePointer();
    if (!pending.current) preview(valueRef.current);
  }

  async function commit(next: number) {
    if (!editable || disabled || pending.current) return;
    const progress = normalize(next);
    if (progress === valueRef.current) {
      preview(valueRef.current);
      return;
    }
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      await onCommit?.(progress);
      if (mounted.current) preview(progress);
    } catch (e) {
      if (mounted.current) {
        preview(valueRef.current);
        setError(`进度保存失败：${e instanceof Error ? e.message : String(e)}`);
      }
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  function commitNumber() {
    const next = numberText.trim() === "" ? NaN : Number(numberText);
    if (!Number.isInteger(next) || next < 0 || next > 100) {
      preview(valueRef.current);
      setError("请输入 0 到 100 的整数");
      return;
    }
    void commit(next);
  }

  if (!editable) {
    return (
      <div className={`flex items-center gap-2 ${className}`} title={`${label}：${current}%`}>
        <div role="progressbar" aria-label={label} aria-valuenow={current} aria-valuemin={0} aria-valuemax={100} className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-line-soft">
          <div className="h-full rounded-full bg-t2" style={{ width: `${current}%` }} />
        </div>
        <span className="w-10 flex-none text-right text-[11.5px] tabular-nums text-ink-muted">{current}%</span>
      </div>
    );
  }

  return (
    <div
      className={className}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      onKeyUp={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-2" aria-busy={busy}>
        <input
          ref={rangeRef}
          type="range"
          min={0}
          max={100}
          step={1}
          value={draft}
          disabled={locked}
          aria-label={label}
          aria-valuetext={`${draft}%`}
          aria-describedby={error ? `${id}-error` : undefined}
          className="todo-progress-range min-w-0 flex-1"
          style={{ "--todo-progress": `${draft}%` } as React.CSSProperties}
          onChange={(e) => {
            if (locked) return;
            if (cancelled.current) {
              preview(valueRef.current);
              return;
            }
            const next = Number(e.target.value);
            preview(next);
            // 辅助技术可直接触发 change,不一定产生 pointer/key 事件。
            if (pointer.current === null && !keyboard.current) void commit(next);
          }}
          onFocus={() => { cancelled.current = false; }}
          onPointerDown={(e) => {
            if (locked || e.isPrimary === false || e.button !== 0 || pointer.current !== null) return;
            cancelled.current = false;
            pointer.current = e.pointerId;
            keyboard.current = false;
            setError(null);
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerUp={(e) => {
            if (pointer.current !== e.pointerId) return;
            const next = draftRef.current;
            releasePointer();
            void commit(next);
          }}
          onPointerCancel={cancel}
          onLostPointerCapture={() => { if (pointer.current !== null) cancel(); }}
          onBlur={cancel}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              cancel();
            } else if (RANGE_KEYS.has(e.key)) {
              cancelled.current = false;
              keyboard.current = true;
              setError(null);
            }
          }}
          onKeyUp={(e) => {
            if (RANGE_KEYS.has(e.key) && keyboard.current) {
              keyboard.current = false;
              void commit(Number(e.currentTarget.value));
            }
          }}
        />
        <span className="w-10 flex-none text-right text-[11.5px] tabular-nums text-ink-2">{draft}%</span>
        {busy && <span role="status" className="text-[11px] text-ink-muted">保存中…</span>}
      </div>
      {showInput && (
        <div
          className="mt-1 flex flex-wrap items-center gap-2"
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) cancel();
          }}
        >
          <label htmlFor={`${id}-number`} className="text-[12px] text-ink-muted">精确进度</label>
          <input
            id={`${id}-number`}
            type="number"
            inputMode="numeric"
            min={0}
            max={100}
            step={1}
            value={numberText}
            disabled={locked}
            className="input !w-20 tabular-nums"
            aria-label={`${label}百分比`}
            aria-describedby={error ? `${id}-error` : undefined}
            onChange={(e) => {
              setNumberText(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitNumber();
              } else if (e.key === "Escape") {
                e.preventDefault();
                cancel();
              }
            }}
          />
          <span className="text-[12px] text-ink-muted">%</span>
          <button type="button" className="btn-secondary" disabled={locked} onClick={commitNumber}>应用</button>
          <span className="text-[11.5px] text-ink-muted">Enter 应用，Esc 取消</span>
        </div>
      )}
      {error && <p id={`${id}-error`} role="alert" className="m-0 mt-1 text-[12px] text-accent">{error}</p>}
    </div>
  );
}
