/**
 * todo.md 的格式常量与共享读写工具。
 *
 * 唯一权威约定:字段分隔符必须是**全角冒号 U+FF1A**,不是半角 `:`。
 * 半角冒号不会报错,只会让 `类型`/`来源` 等字段静默解析为空——历史上踩过。
 * 所有读写路径一律从这里取常量,不要各写各的字面量。
 */

/** 全角冒号(字段分隔符)。 */
export const COLON = "\uFF1A";
/** 名称与说明的分隔符(两个 em dash)。 */
export const NOTE_SEP = "\u2014\u2014";
/** 分组名分隔符(如「示例项目 · 示例系统」)。 */
export const GROUP_SEP = " \u00B7 ";

/** 字段标签。 */
export const FIELD = {
  priority: "优先级",
  progress: "进度",
  start: "预计开始",
  due: "预计完成",
  type: "类型",
  source: "来源",
  doneText: "完成情况",
  doneImgs: "完成附件",
  feedback: "反馈",
  reply: "回复",
} as const;

/** `- [ ] 事项名 ...` / `- [x] 事项名 ...` */
export const CHECKBOX_RE = /^-\s*\[([ xX])\]\s+(.+)$/;
/** `- **字段**:值`(顶层或缩进子行都匹配,缩进由调用方判断)。 */
export const SUBFIELD_RE = new RegExp(`^-\\s*\\*\\*([^*]+)\\*\\*${COLON}(.*)$`);
/** 反馈行内嵌的身份前缀:`[反馈方 · YYYY-MM-DD HH:MM]`。 */
export const FEEDBACK_HEAD_RE = /^\[([^\]]+?)\s*\u00B7\s*(\d{4}-\d{2}-\d{2}(?:\s+\d{2}:\d{2})?)\]\s*([\s\S]*)$/;
/** `![说明](路径)` */
export const IMG_RE = /^\s*!\[([^\]]*)\]\(([^)]+)\)\s*$/;

export interface TodoImage {
  alt: string;
  src: string;
}

export interface TodoCompletion {
  text: string;
  images: TodoImage[];
}

/** 一条反馈:谁、何时、说了什么、附图;可带一条管理员回复。 */
export interface TodoFeedback {
  by: string;
  at: string;
  text: string;
  images: TodoImage[];
  /** 管理员回复(紧跟该反馈);无则各项为空。 */
  reply?: { by: string; at: string; text: string; images: TodoImage[] };
}

export interface ParsedTodoLine {
  checked: boolean;
  name: string;
  note: string;
  priority: string;
  progress: number;
  start: string;
  due: string;
  type: string;
  source: string;
  sourceText: string;
}

/** 待办完成进度的唯一数值约束(不接受字符串、小数或越界值)。 */
export function isTodoProgress(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 100;
}

/** 新建/重命名需可往返解析,禁止把名称里的格式字符当成说明或来源。 */
export function todoNameError(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return "事项名称不能为空";
  if (/[\r\n]/.test(value) || value.includes(NOTE_SEP) || value.includes("|")) {
    return "事项名称不能包含换行、竖线或说明分隔符——，请将补充内容写入说明";
  }
  if (value.includes("**已于") || value.includes(`${FIELD.source}${COLON}[`)) {
    return "事项名称不能包含完成标记或来源字段，请将补充内容写入说明";
  }
  return null;
}

/**
 * 解析一条待办主行(与 parser.parseTodo 同规则)。
 * 注意:标签后的分隔符是全角冒号。
 */
export function parseTodoLine(line: string): ParsedTodoLine | null {
  const m = line.trim().match(CHECKBOX_RE);
  if (!m) return null;
  const checked = m[1].toLowerCase() === "x";
  let rest = m[2].trim();

  let source = "";
  let sourceText = "";
  const lm = rest.match(new RegExp(`${FIELD.source}${COLON}\\[([^\\]]+)\\]\\(([^)]+)\\)`));
  if (lm) {
    sourceText = lm[1];
    source = lm[2];
    rest = rest.slice(0, lm.index!).trim();
  }
  // 字段只从 `| 标签：值` 管道分段中取,避免说明段内出现同名文字(如「申报类型：」)被误解析
  const tm = rest.match(new RegExp(`\\|\\s*${FIELD.type}${COLON}(\\S+)`));
  const type = tm ? tm[1] : "";
  rest = rest
    .replace(new RegExp(`\\|\\s*${FIELD.type}${COLON}\\S+`), "")
    .trim();

  const pm = rest.match(new RegExp(`\\|\\s*${FIELD.priority}${COLON}(\\S+)`));
  const priority = pm ? pm[1] : "";
  rest = rest
    .replace(new RegExp(`\\|\\s*${FIELD.priority}${COLON}\\S+`), "")
    .trim();

  const dm = rest.match(new RegExp(`\\|\\s*${FIELD.due}${COLON}(\\S+)`));
  const due = dm ? dm[1] : "";
  rest = rest
    .replace(new RegExp(`\\|\\s*${FIELD.due}${COLON}\\S+`), "")
    .trim()
    .replace(/\|+$/, "")
    .trim();

  const progressMatch = rest.match(new RegExp(`\\|\\s*${FIELD.progress}${COLON}([^|]*)`));
  const rawProgress = progressMatch?.[1].trim();
  const explicitProgress = rawProgress && /^\d{1,3}$/.test(rawProgress) ? Number(rawProgress) : undefined;
  // 旧记录不批量改写:已勾选默认100,未勾选默认0;显式非法/矛盾字段由record check报告。
  const progress = checked ? 100 : isTodoProgress(explicitProgress) && explicitProgress < 100 ? explicitProgress : 0;
  rest = rest.replace(new RegExp(`\\|\\s*${FIELD.progress}${COLON}[^|]*`), "").trim();

  const sm = rest.match(new RegExp(`\\|\\s*${FIELD.start}${COLON}(\\S+)`));
  const start = sm ? sm[1] : "";
  rest = rest
    .replace(new RegExp(`\\|\\s*${FIELD.start}${COLON}\\S+`), "")
    .trim()
    .replace(/\|+$/, "")
    .trim();

  let name = rest;
  let note = "";
  const sep = rest.indexOf(NOTE_SEP);
  if (sep >= 0) {
    name = rest.slice(0, sep);
    note = rest.slice(sep + NOTE_SEP.length);
  }

  return {
    checked,
    name: name.trim(),
    note: note.trim(),
    priority,
    progress,
    start,
    due,
    type,
    source,
    sourceText,
  };
}

/** 行是否为缩进子行(用于区分子块与下一条待办)。 */
export function isIndented(line: string): boolean {
  return /^\s+\S/.test(line);
}

/** 从一组缩进子行中收集完成情况(不含反馈)。 */
export function parseCompletion(lines: string[]): TodoCompletion {
  const out: TodoCompletion = { text: "", images: [] };
  let curField = "";
  for (const raw of lines) {
    const m = raw.trim().match(SUBFIELD_RE);
    if (m) {
      curField = m[1].trim();
      const val = m[2].trim();
      if (curField === FIELD.doneText) out.text = val;
      continue;
    }
    const im = raw.match(IMG_RE);
    if (im) {
      if (curField === FIELD.doneImgs || curField === FIELD.doneText) {
        out.images.push({ alt: im[1].trim(), src: im[2].trim() });
      }
      continue;
    }
    const t = raw.trim();
    if (t && curField === FIELD.doneText) {
      out.text += (out.text ? "\n" : "") + t;
    }
  }
  return out;
}

/**
 * 一次性解析条目下的缩进子块:完成情况 + 若干条反馈(反馈可各带一条回复)。
 * 反馈以 `- **反馈**：` 子行分组;其后更深层缩进的 `- **回复**：` 子行是该反馈的回复。
 */
export function parseSubBlocks(lines: string[]): {
  completion: TodoCompletion;
  feedback: TodoFeedback[];
} {
  const completion: TodoCompletion = { text: "", images: [] };
  const feedback: TodoFeedback[] = [];
  let cur = ""; // "completion" | "feedback" | "reply" | ""
  let curFb: TodoFeedback | null = null;

  for (const raw of lines) {
    const m = raw.trim().match(SUBFIELD_RE);
    if (m) {
      const field = m[1].trim();
      const val = m[2].trim();
      if (field === FIELD.feedback) {
        cur = "feedback";
        const head = val.match(FEEDBACK_HEAD_RE);
        curFb = head
          ? { by: head[1].trim(), at: head[2].trim(), text: head[3].trim(), images: [] }
          : { by: "", at: "", text: val, images: [] };
        feedback.push(curFb);
      } else if (field === FIELD.reply && curFb) {
        // 回复属于最近一条反馈
        cur = "reply";
        const head = val.match(FEEDBACK_HEAD_RE);
        curFb.reply = head
          ? { by: head[1].trim(), at: head[2].trim(), text: head[3].trim(), images: [] }
          : { by: "", at: "", text: val, images: [] };
      } else {
        cur = "completion";
        curFb = null;
        if (field === FIELD.doneText) completion.text = val;
      }
      continue;
    }
    const im = raw.match(IMG_RE);
    if (im) {
      const img = { alt: im[1].trim(), src: im[2].trim() };
      if (cur === "reply" && curFb?.reply) curFb.reply.images.push(img);
      else if (cur === "feedback" && curFb) curFb.images.push(img);
      else if (cur === "completion") completion.images.push(img);
      continue;
    }
    const t = raw.trim();
    if (!t) continue;
    if (cur === "reply" && curFb?.reply) curFb.reply.text += (curFb.reply.text ? "\n" : "") + t;
    else if (cur === "feedback" && curFb) curFb.text += (curFb.text ? "\n" : "") + t;
    else if (cur === "completion") completion.text += (completion.text ? "\n" : "") + t;
  }
  return { completion, feedback };
}

/**
 * 生成一条待办主行。字段顺序:名称 —— 说明 | 优先级：高 | 进度：0 | 预计开始：YYYY-MM-DD | 预计完成：YYYY-MM-DD | 类型：X | 来源：[..](..)
 * 分隔符一律全角冒号。
 * 名称与说明中的换行会被压成空格——todo.md 的主行必须是单行,
 * 否则一行会被劈成两条,尾部的 优先级/类型/来源 会脱离主行而静默丢失。
 */
export function buildTodoLine(opts: {
  name: string;
  note?: string;
  priority?: string;
  progress?: number;
  start?: string;
  due?: string;
  type?: string;
  source?: string;
  sourceText?: string;
}): string {
  if (opts.progress !== undefined && !isTodoProgress(opts.progress)) {
    throw new Error("待办进度需为0–100的整数");
  }
  const parts = [opts.name.trim().replace(/\s*\n\s*/g, " ")];
  const note = opts.note ? opts.note.trim().replace(/\s*\n\s*/g, " ") : "";
  if (note) parts.push(`${NOTE_SEP} ${note}`);
  let line = `- [ ] ${parts.join(" ")}`;
  if (opts.priority) line += ` | ${FIELD.priority}${COLON}${opts.priority}`;
  if (opts.progress !== undefined) line += ` | ${FIELD.progress}${COLON}${opts.progress}`;
  if (opts.start) line += ` | ${FIELD.start}${COLON}${opts.start}`;
  if (opts.due) line += ` | ${FIELD.due}${COLON}${opts.due}`;
  if (opts.type) line += ` | ${FIELD.type}${COLON}${opts.type}`;
  if (opts.source) {
    const label = opts.sourceText || opts.source;
    line += ` | ${FIELD.source}${COLON}[${label}](${opts.source})`;
  }
  return line;
}

/** 生成缩进的完成情况子块(文字 + 图片)。 */
export function buildCompletionLines(
  completion: TodoCompletion,
  toSrc: (src: string) => string = (s) => s,
): string[] {
  const out: string[] = [];
  const text = completion.text.trim();
  if (text) {
    // 多行文字压成一行,避免破坏 todo.md 的行结构
    out.push(`  - **${FIELD.doneText}**${COLON}${text.replace(/\s*\n\s*/g, " ")}`);
  }
  if (completion.images.length) {
    out.push(`  - **${FIELD.doneImgs}**${COLON}`);
    for (const im of completion.images) {
      out.push(`    ![${im.alt || "完成截图"}](${toSrc(im.src)})`);
    }
  }
  return out;
}

/** 生成一条反馈的缩进子块(身份前缀 + 文字 + 图片,可含回复)。 */
export function buildFeedbackLines(
  fb: TodoFeedback,
  toSrc: (src: string) => string = (s) => s,
): string[] {
  const head = `[${fb.by || "匿名"} \u00B7 ${fb.at}]`;
  const text = fb.text.trim().replace(/\s*\n\s*/g, " ");
  const out = [`  - **${FIELD.feedback}**${COLON}${head}${text ? " " + text : ""}`];
  for (const im of fb.images) {
    out.push(`    ![${im.alt || "反馈截图"}](${toSrc(im.src)})`);
  }
  if (fb.reply && (fb.reply.text.trim() || fb.reply.images.length)) {
    const rhead = `[${fb.reply.by || "管理员"} \u00B7 ${fb.reply.at}]`;
    const rtext = fb.reply.text.trim().replace(/\s*\n\s*/g, " ");
    out.push(`    - **${FIELD.reply}**${COLON}${rhead}${rtext ? " " + rtext : ""}`);
    for (const im of fb.reply.images) {
      out.push(`      ![${im.alt || "回复截图"}](${toSrc(im.src)})`);
    }
  }
  return out;
}

/** 该项目在 todo.md 中已有的分组标题(前缀匹配「项目名 ·」)。 */
export function existingGroups(lines: string[], projectName: string): string[] {
  const out: string[] = [];
  for (const ln of lines) {
    const s = ln.trim();
    if (!s.startsWith("### ")) continue;
    const g = s.slice(4).trim();
    if (g === projectName || g.startsWith(`${projectName}${GROUP_SEP}`) || g.startsWith(`${projectName}\u00B7`)) {
      out.push(g);
    }
  }
  return out;
}