/** 与后端 API 对应的数据结构。 */

export type TypeOrder = string[];

export interface BlockImage {
  alt: string;
  url: string;
}

export interface Block {
  field: string;
  text: string;
  images: { alt: string; src: string }[];
  imageUrls: BlockImage[];
  html: string;
}

export interface Entry {
  time: string;
  title: string;
  type: string;
  module: string;
  anchor: string;
  blocks: Block[];
}

export interface DayMeta {
  project: string;
  system: string;
  summary: string;
}

export interface Day {
  slug: string;
  projectName: string;
  date: string;
  month: string;
  weekday: string;
  meta: DayMeta;
  entries: Entry[];
  counts: Record<string, number>;
  attachments: string;
}

export interface RecentDay {
  slug: string;
  projectSlug: string;
  projectName: string;
  date: string;
  weekday: string;
  entryCount: number;
  entries: { time: string; title: string; module: string; type: string; anchor: string }[];
}

export interface ProjectSummary {
  slug: string;
  name: string;
  systems: string[];
  dayCount: number;
  entryCount: number;
  counts: Record<string, number>;
  /** 已登记但还没有记录的项目没有日期范围。 */
  dateRange: [string, string] | [] | null;
}

/** 已登录用户可读取的完整项目目录，包含尚无记录的项目。 */
export interface ProjectsResponse {
  projects: ProjectSummary[];
}

export interface ProjectDetail extends ProjectSummary {
  modules: { name: string; count: number }[];
  days: Day[];
}

export interface Overview {
  typeOrder: TypeOrder;
  /** 是否已登录(未登录时 recentDays 为空、systems 不下发)。 */
  authed: boolean;
  projectCount: number;
  entryCount: number;
  dayCount: number;
  todoOpen: number;
  todoDone: number;
  counts: Record<string, number>;
  recentDays: RecentDay[];
  projects: ProjectSummary[];
}

export interface DayResponse extends Day {
  typeOrder: TypeOrder;
  projectSlug: string;
  /** 相邻日期(该项目内,缺省为 null)。 */
  prev: string | null;
  next: string | null;
}

/** 全部记录浏览:条目简要。 */
export interface EntrySummary {
  time: string;
  title: string;
  module: string;
  type: string;
  anchor: string;
}

/** 全部记录浏览:单日摘要。 */
export interface DaySummary {
  slug: string;
  projectName: string;
  system: string;
  date: string;
  weekday: string;
  entryCount: number;
  summary: string;
  counts: Record<string, number>;
  entries: EntrySummary[];
}

export interface RecordsResponse {
  offset: number;
  limit: number;
  total: number;
  dayCount: number;
  items: DaySummary[];
}

/** 搜索命中。 */
export interface SearchHit {
  slug: string;
  projectName: string;
  date: string;
  weekday: string;
  time: string;
  title: string;
  module: string;
  type: string;
  anchor: string;
  snippet: string;
}

/** 待办搜索命中(匹配名称/说明/分组/完成情况/反馈)。 */
export interface TodoSearchHit {
  name: string;
  note: string;
  progress: number;
  source: string;
  sourceText: string;
  group: string;
  type: string;
  priority: string;
  start: string;
  due: string;
  status: "open" | "done";
  snippet: string;
}

export interface SearchResponse {
  q: string;
  total: number;
  items: SearchHit[];
  todos: TodoSearchHit[];
}

/** AI 问答返回。 */
export interface AiAskRef {
  kind: "record" | "todo";
  label: string;
  to: string;
}

export interface AiAskResponse {
  ok: true;
  answer: string;
  terms: string[];
  refs: AiAskRef[];
}

/** 收件箱条目。 */
export interface InboxItem {
  id: string;
  at: string;
  text: string;
  images: { alt: string; url: string }[];
}

export interface InboxResponse {
  items: InboxItem[];
  count: number;
}

/** 汇报生成返回。 */
export interface ReportStats {
  from: string;
  to: string;
  dayCount: number;
  entryCount: number;
  counts: Record<string, number>;
  doneCount: number;
  projects: { name: string; days: number; entries: number }[];
}

export interface ReportResponse {
  from: string;
  to: string;
  markdown: string;
  html: string;
  stats: ReportStats;
}

/** 登录状态。 */
export interface MeResponse {
  authed: boolean;
  configured: boolean;
}

/** 分享链接。 */
export type ShareMode = "view" | "edit";

export interface Share {
  token: string;
  project: string;
  mode: ShareMode;
  label: string;
  /** 反馈方(生成链接时写死)。 */
  feedbackBy: string;
  createdAt: string;
}

export interface SharesResponse {
  items: Share[];
}

/** 分享页内容(免登录)。 */
export interface ShareTodoItem {
  name: string;
  note: string;
  progress: number;
  priority?: string;
  start?: string;
  due?: string;
  type: string;
  group: string;
  source: string;
  sourceText: string;
  created: boolean;
  completion: TodoCompletion;
  feedback: TodoFeedback[];
}

export interface SharePayload {
  token: string;
  mode: ShareMode;
  label: string;
  feedbackBy: string;
  project: { slug: string; name: string; systems: string[] };
  todo: {
    open: ShareTodoItem[];
    done: ShareTodoItem[];
  };
  /** 模块与验收清单(只读展示;全库分享为空)。 */
  modules: ModuleItem[];
}

/** 完成情况(文字 + 图片)。 */
export interface TodoCompletion {
  text: string;
  images: { alt: string; src: string }[];
}

/** 一条反馈(分享链接提交,可多条)。 */
export interface TodoFeedback {
  by: string;
  at: string;
  text: string;
  images: { alt: string; src: string }[];
  /** 管理员回复(可选)。 */
  reply?: { by: string; at: string; text: string; images: { alt: string; src: string }[] };
}

export interface TodoItem {
  name: string;
  note: string;
  /** 完成进度(0-100 的整数);完成状态由所在数组判定。 */
  progress: number;
  priority?: string;
  start?: string;
  due?: string;
  type: string;
  group: string;
  source: string;
  sourceText: string;
  completion: TodoCompletion;
  feedback: TodoFeedback[];
  /** 本站新建(无来源链接)。 */
  created: boolean;
}

export interface TodoResponse {
  priorityOrder?: readonly string[];
  typeOrder: TypeOrder;
  open: TodoItem[];
  done: TodoItem[];
  counts: Record<string, number>;
  groups: string[];
}

/** 待办写入后的权威快照;item 本身不含 done。 */
export interface TodoMutationResponse {
  ok: true;
  item: TodoItem;
  done: boolean;
  previous: { name: string; source: string };
  progress: number;
  images?: string[];
  result?: string;
}

/** 分享勾选沿用既有写权限,仅返回该项目的待办快照。 */
export interface ShareTodoMutationResponse extends Omit<TodoMutationResponse, "item"> {
  item: ShareTodoItem;
}

/** AI 可用状态。 */
export interface AiStatus {
  configured: boolean;
  model: string;
}

/** AI 配置(设置页;密钥打码,不回传明文)。 */
export interface AiConfigInfo {
  ok?: true;
  configured: boolean;
  url: string;
  model: string;
  keyMasked: string;
  source: "override" | "env";
}

/** 项目模块清单(验收进度)。 */
export type ModuleStatus = "未开始" | "进行中" | "待验收" | "已验收";

export interface ModuleSub {
  name: string;
  status: ModuleStatus;
  progress: number;
  note: string;
  updated: string;
}

export interface ModuleItem {
  name: string;
  status: ModuleStatus;
  progress: number;
  note: string;
  updated: string;
  /** 子模块(嵌套层级,父子各有独立验收状态)。 */
  subs: ModuleSub[];
}

export interface ModulesResponse {
  modules: ModuleItem[];
}

/** 站点设置汇总(密钥/口令一律打码)。 */
export interface SettingsResponse {
  ai: AiConfigInfo;
  notify: { configured: boolean; webhookMasked: string };
  digest: { time: string; staleDays: number };
  password: { overridden: boolean; source: string };
  overrideFile: string;
}

export interface SaveSettingsResult {
  ok: true;
  timer?: { ok: boolean; error?: string } | null;
  /** 只有 true 才确认系统定时器已同步；未启用时仅保存配置。 */
  timerSynced?: boolean;
  message?: string;
}

/** 整理 Agent 状态与运行摘要。 */
export type AgentLevel = "off" | "L1" | "L2";

export interface AgentRunSummary {
  id: string;
  startedAt?: string;
  level?: string;
  dry?: boolean;
  executed?: number;
  suggested?: number;
  pendingReview?: number;
  validationOk?: boolean;
  rolledBack?: boolean;
  summary?: string;
}

export interface AgentStatusResponse {
  level: AgentLevel;
  running: boolean;
  last: AgentRunSummary | null;
}

export interface AgentRunsResponse {
  items: AgentRunSummary[];
}

export interface AiModelsResponse {
  ok: true;
  models: string[];
}

export interface AiTestResponse {
  ok: true;
  ms: number;
  reply: string;
}

/** AI 解析出的待办草稿。 */
export interface AiTodoDraft {
  name: string;
  note: string;
  priority?: string;
  type: string;
  projectName: string;
  degraded: boolean;
}

/** 修改待办补丁。 */
export interface UpdateTodoPatch {
  name?: string;
  note?: string;
  priority?: string;
  start?: string;
  due?: string;
  progress?: number;
  type?: string;
  project?: string;
  group?: string;
  images?: { dataUrl: string; alt?: string }[];
}