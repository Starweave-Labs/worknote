# WorkNote 代码与功能索引

本索引描述开源通用版本。部署环境无固定客户名单、域名或服务器路径，真实数据由 `WORKNOTE_ROOT` 指定，默认 `data/`。

## 架构

```text
React SPA → 同源 /api、/attachments → Fastify 单进程
                                     ├── projects.json 项目登记
                                     ├── projects/*/daily 每日Markdown
                                     ├── todo.md 全库待办
                                     ├── inbox.md 快速捕获
                                     └── modules.md / shares.json / site-config.json

可选：OpenAI兼容网关、通知Webhook、CLI、私有数据Git快照、systemd调度
```

构建后 `public/app/` 可由API同进程托管；Vite开发/预览代理可配置后端地址。记录与待办解析按文件状态实时生效，数据改动无需重建。

## 根目录工具

| 文件 | 职责 |
|---|---|
| `package.json` | setup/build/init/start/test/check与query/record/digest/agent入口 |
| `scripts/init.mjs` | 建私有数据基础文件、登记项目、生成随机口令与密钥，保留已有数据 |
| `.env.example` | 登录、数据根、监听、AI、通知与自动化选项，不含真实凭据 |
| `Dockerfile` / `compose.yaml` | 多阶段构建、非root单进程、独立数据卷 |
| `examples/` | 完全虚构项目与record add演示 |
| `.github/workflows/ci.yml` | Node构建/单测/类型/依赖审查与容器构建 |
| `test/init.test.mjs` | 初始化与保留已有数据测试 |

## 后端模块

| 文件 | 主要职责 |
|---|---|
| `environment.ts` | `sourceRoot`、`dataRoot()`、加载.env/显式WORKNOTE_ENV_FILE；现有env优先 |
| `projects.ts` | `validateProjectConfig`、`readProjectConfig`、`getProjectNames`；严格校验项目数组、无文件时发现旧数据 |
| `parser.ts` | collect/parseTodo/搜索/日摘要；含空登记项目、动态中文名、进度、完成说明/反馈/回复 |
| `index.ts` | 路由、登录守卫、公开脱敏总览、附件边界、静态SPA、可选systemd控制 |
| `render-markdown.ts` | marked解析后允许列表HTML净化，拒绝执行内容与不安全链接 |
| `todo-format.ts` | 全角分隔符、主行/子块读写、合法progress与完成标记权威格式 |
| `todo-create.ts` | 新建按项目/系统分组末尾落位 |
| `todo-write.ts` | 完成/取消/进度/编辑/删除/反馈/回复，原子最小改动，保留子块 |
| `daylog-write.ts` | 完成首次进入100时追加当日日记录，支持无记录项目 |
| `attachments-write.ts` | 原图解码校验与保存（6图、单图8MiB），644/755 |
| `thumbnail.ts` | sharp WebP缩略图与私有缓存，原图不变 |
| `auth.ts` | 单口令HMAC会话、Secure缺省、失败IP限流 |
| `shares.ts` | 随机24字节token、读/edit权限、反馈身份、修改/撤销，600原子写 |
| `site-config.ts` | 数据目录配置覆盖，600原子写，环境兜底 |
| `ai.ts` | OpenAI兼容网关、待办/完成说明/问答/概要、配置与连通测试 |
| `notify.ts` | 可选Webhook平台报文、10秒超时、失败不阻塞 |
| `inbox.ts` | 收件箱条目与附件保存/删除 |
| `modules.ts` | 父子两级验收实体；父进度均值、0/80/100状态阈值 |
| `report.ts` | 日期区间确定性汇报、完成与逾期统计 |
| `query.ts` | 多关键词AND、项目/日期/类型/模块/状态结构化检索 |
| `record.ts` | add/check/done/summary：记录、附件、索引和待办联动 |
| `digest.ts` | 晨报聚合、可选通知和数据快照 |
| `agent.ts` / `agent-tools.ts` | 观察/规划/执行/校验循环、三色工具策略、默认off |
| `data-snapshot.ts` | 显式opt-in且只在独立数据根Git操作，拒绝借源码仓库，失败限域恢复 |
| `server/test/` | 待办进度/隔离API/配置与安全边界/Markdown净化回归 |

## API

路径均同源，无外部站点硬编码。

| 权限 | 路径 | 功能 |
|---|---|---|
| 公开 | `GET /api/health` | 健康检查 |
| 公开 | `GET /api/overview` | 未登录仅数字与项目名称；登录后含最近记录 |
| 公开 | `POST /api/login`、`POST /api/logout`、`GET /api/me` | 登录状态 |
| 登录 | `GET /api/projects` | 动态项目摘要数组（slug/name/systems/dayCount/entryCount/counts/dateRange），含空项目 |
| 登录 | `GET /api/projects/:slug`、`GET /api/days/:slug/:date` | 项目/单日记录，单日prev/next |
| 登录 | `GET /api/todo`、`GET /api/records`、`GET /api/search` | 全库待办、分页归档、记录与待办双结果 |
| 登录 | `POST/PATCH/DELETE /api/todos` | 创建/编辑/删除；创建progress、编辑patch.progress |
| 登录 | `POST /api/todos/complete`、`POST /api/todos/undone` | 完成100 / 取消0，完成内容同步日记录 |
| 登录 | `POST /api/todos/feedback-reply` | 管理员回复某反馈，重复替换 |
| 登录 | `POST /api/todos/ai-parse`、`POST /api/todos/ai-create` | AI草稿预览 / 确认写入 |
| 登录 | `GET /api/ai/status`、`POST /api/ai/ask`、`POST /api/ai/models`、`POST /api/ai/test` | 可选AI功能 |
| 登录 | `GET/POST /api/settings`、`POST /api/notify/test` | 配置覆盖/重置与通知测试；timerSynced如实返回 |
| 登录 | `GET /api/agent/status`、`GET /api/agent/runs`、`POST /api/agent/run` | 运行状态/日志；run需显式systemd |
| 登录 | `GET/POST/DELETE /api/inbox`、`GET /api/inbox/attachment/:file` | 快速捕获与附件 |
| 登录 | `GET /api/report?from=&to=` | Markdown + 净化html + stats |
| 登录 | `GET/POST/DELETE /api/modules/:slug` | 项目模块登记与两级验收 |
| 登录 | `GET/POST /api/shares`、`PATCH/DELETE /api/shares/:token` | 生成、编辑、撤销分享 |
| 登录 | `GET /attachments/:slug/:date/:file` | 合法日期/路径图片，支持thumb |
| Token | `GET /api/share/:token` | 项目待办/模块/排期；_all为全库待办/排期，不聚合模块 |
| Token | `GET /api/share/:token/attachment/*` | 授权待办实际引用的图片，不读日记录或无关文件 |
| Token edit | `POST /api/share/:token/todo`、`POST /api/share/:token/feedback` | 勾选与反馈，要求X-Requested-With:worknote，无百分比编辑 |

待办写成功返回权威 `item` / `done` / `progress` / `previous:{name,source}`，前端据此即时归位，不猜测服务端状态。

## 前端页面与组件

| 页面 | 路径/重点 |
|---|---|
| OverviewPage | `/`：统计、最近记录、项目卡，公共脱敏 |
| TodoPage | `/todo`：列表/看板、筛选/排序/分页、动态项目选择、进度保存 |
| RecordsPage | `/records`：自然日时间轴/归档卡片、项目/月过滤、独立分页 |
| ProjectPage | `/projects/:slug`：空项目、记录、模块与验收、分享对话框 |
| DayPage | `/days/:slug/:date`：净化字段文本、图片灯箱、来源锚点、上下日 |
| SharePage | `/share/:token`：免登录、列表/看板/只读排期、反馈、进度只读 |
| CalendarPage | `/calendar`：月历/甘特、pointer起止拖拽、无排期待办池 |
| InboxPage | `/inbox`：快速文字/截图捕获、PWA分享内容读取、查看/删除 |
| ReportPage | `/report`：区间预设与自定义、生成/复制/下载 |
| SettingsPage | `/settings`：AI/通知/晨报/口令/Agent，系统调度禁用时如实提示 |
| SearchPage | `/search?mode=kw|ai`：关键词记录+待办双结果或AI附参考资料 |
| LoginPage | `/login`：单口令登录、配置缺失提示 |

核心组件：Layout、NewTodoDialog、EditTodoDialog、CompleteTodoDialog、TodoDetailDialog、FeedbackDialog/FeedbackList、ShareDialog、TodoKanban、TodoProgress、ScheduleBoard、NoteText、ThumbImage、Lightbox、ImagePicker、Pagination、Tags、Metabox。

鉴权层启动读取/api/me；动态项目共享状态只在已登录时请求/api/projects。侧栏、新建、编辑不依赖固定项目常量。todo-state按权威快照更新，todo-sort解析时间/预计完成；schedule工具维护月历与甘特坐标。index.css是按钮/输入/标签/卡片基座。

## 约束速查

- Markdown全角冒号与单行todo主行不可改变。
- progress100联动勾选与完成日期；模块进度80%阈值与待办无关。
- 一个数据根一个写进程；跨进程锁/多租户不提供。
- 默认AI/Webhook空、Agent off、systemd/Git快照关。
- 数据与密钥不跟踪；仅虚构examples可以发布。
- 构建与测试不等于浏览器交互验证，发布结果需如实报告。
