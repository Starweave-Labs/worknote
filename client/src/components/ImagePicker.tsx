/**
 * 图片选择与预览工具。
 *
 * 上传走 base64 JSON(与现有 api.ts 的 request() 一致,不引入 multipart)。
 * 每个文件转成 data URL,同时留一个预览用的 objectURL。
 */

import { useRef, useState } from "react";

export interface PickedImage {
  /** 原始文件名(用于说明)。 */
  name: string;
  /** data URL(上传用)。 */
  dataUrl: string;
}

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_FILES = 6;

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("读取图片失败"));
    r.readAsDataURL(file);
  });
}

export function useImagePicker() {
  const [images, setImages] = useState<PickedImage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  async function addFiles(files: FileList | File[] | null) {
    if (!files || !files.length) return;
    setError(null);
    const next: PickedImage[] = [];
    for (const f of Array.from(files)) {
      if (!f.type.startsWith("image/")) {
        setError("只能选择图片文件");
        continue;
      }
      if (f.size > MAX_BYTES) {
        setError(`图片「${f.name}」超过 ${MAX_BYTES / 1024 / 1024}MB`);
        continue;
      }
      next.push({ name: f.name, dataUrl: await fileToDataUrl(f) });
    }
    setImages((prev) => [...prev, ...next].slice(0, MAX_FILES));
  }

  function remove(idx: number) {
    setImages((prev) => prev.filter((_, i) => i !== idx));
  }

  function clear() {
    setImages([]);
    setError(null);
  }

  return { images, error, inputRef, addFiles, remove, clear, setError };
}

/** 图片选择区(供各对话框复用)。 */
export function ImagePicker({
  picker,
}: {
  picker: ReturnType<typeof useImagePicker>;
}) {
  const { images, error, inputRef, addFiles, remove } = picker;
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="rounded-md border border-line bg-surface px-3 py-1.5 text-[13px] text-ink-2 transition hover:border-accent hover:text-accent"
        >
          选择图片
        </button>
        <span className="text-[12.5px] text-ink-muted">
          最多 6 张,单张 ≤ 8MB(原图保存,不压缩)
        </span>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          void addFiles(e.target.files);
          e.target.value = "";
        }}
      />
      {error && <p className="mt-1.5 text-[12.5px] text-t3">{error}</p>}
      {!!images.length && (
        <div className="mt-2 flex flex-wrap gap-2">
          {images.map((im, i) => (
            <div key={i} className="group relative">
              <img
                src={im.dataUrl}
                alt={im.name}
                className="h-[76px] w-[76px] rounded-md border border-line object-cover"
              />
              <button
                type="button"
                onClick={() => remove(i)}
                aria-label={`移除 ${im.name}`}
                className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-line bg-surface text-[12px] leading-none text-ink-muted shadow transition hover:text-t3"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * 支持直接粘贴图片的 textarea(富文本粘贴:截图后 Ctrl+V 即上传)。
 * 与 useImagePicker 联动:粘贴的图片进入同一批上传队列。
 */
export function RichTextarea({
  picker,
  value,
  onChange,
  rows,
  placeholder,
  autoFocus,
}: {
  picker: ReturnType<typeof useImagePicker>;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  async function onPaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const items = e.clipboardData?.items;
    if (!items) return;
    const files: File[] = [];
    for (const it of Array.from(items)) {
      if (it.kind === "file" && it.type.startsWith("image/")) {
        const f = it.getAsFile();
        if (f) files.push(f);
      }
    }
    if (!files.length) return; // 普通文本粘贴,走默认行为
    e.preventDefault();
    await picker.addFiles(files);
  }

  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onPaste={onPaste}
      rows={rows ?? 4}
      autoFocus={autoFocus}
      placeholder={placeholder}
      className="w-full resize-y rounded-md border border-line bg-surface px-3 py-2 text-[14px] leading-[1.6] text-ink outline-none transition focus:border-accent"
    />
  );
}
