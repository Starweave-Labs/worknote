# WorkNote 开源项目维护规则

本仓库仅包含通用程序、文档和虚构示例。真实数据放在独立私有数据根，默认 `data/`，可由 `WORKNOTE_ROOT` 指定。**不要复制、提交或外发工作记录、客户截图、token、环境配置和运行日志。**

## 架构与目录

```text
WorkNote/
├── README.md / LICENSE / SECURITY.md / CONTRIBUTING.md
├── AGENTS.md / CODE_INDEX.md
├── .env.example                    # 不含真实凭据
├── Dockerfile / compose.yaml
├── docs/DEPLOYMENT.md
├── examples/                       # 完全虚构的项目与record add输入
├── scripts/init.mjs                # 初始化私有数据、登记项目、生成口令
├── server/
│   ├── src/
│   │   ├── environment.ts          # .env加载、统一dataRoot/sourceRoot
│   │   ├── projects.ts             # projects.json校验/读取/旧目录发现
│   │   ├── parser.ts / index.ts    # Markdown解析与Fastify路由
│   │   ├── render-markdown.ts      # marked + HTML净化
│   │   ├── todo-format.ts          # 权威待办格式/进度/缩进子块
│   │   ├── todo-write.ts / todo-create.ts
│   │   ├── daylog-write.ts / day-index.ts / attachments-write.ts / thumbnail.ts
│   │   ├── auth.ts / shares.ts / site-config.ts
│   │   ├── ai.ts / notify.ts / inbox.ts / modules.ts / report.ts
│   │   ├── query.ts / record.ts / digest.ts
│   │   └── agent.ts / agent-tools.ts / data-snapshot.ts
│   └── test/                      # 临时夹具与隔离API测试
├── client/
│   ├── src/pages/                 # 总览/待办/记录/项目/单日/分享/日历/收件箱/汇报/设置/搜索/登录
│   ├── src/components/            # 可复用弹窗、进度、排期、图片、布局
│   └── src/                       # API/鉴权/动态项目状态/类型/样式
├── test/                          # 初始化测试
├── public/app/                    # 构建生成，不跟踪
└── data/                          # 私有运行数据，不跟踪
```

源代码更新引入功能、API或重要组件时，必须同步更新本文件与 `CODE_INDEX.md`。不再保留旧静态生成器、特定站点 APK 和原生产部署配置。

## 数据与项目

- `data/projects.json` 是项目登记权威：数组项 `{slug,name,system?}`。slug 为小写字母/数字/`-`/`_`，以字母或数字开头，不能使用 prototype 保留键；slug/名称不能重复。名称与系统不能破坏 Markdown 分组格式。
- 没有 `projects.json` 时可从已有项目记录发现；文件存在但非法必须报告，不静默回落。
- 新项目用 `npm run init -- --project example --name "示例项目" --system "演示系统"`。无需改前后端源码，不需要为项目登记重建。
- 配置项目尚无每日记录也必须可选择、可新建待办；空日期范围不渲染非法日期。
- 一切真实数据归于私有数据根：`todo.md`、`index.md`、`inbox.md`、`projects/`、`shares.json`、`site-config.json`、`agent/runs/`。
- 正式记录按项目日期存 `projects/<slug>/daily/YYYY-MM/YYYY-MM-DD/YYYY-MM-DD.md`，图片在其 `attachments/`，保留原件，默认文件644、目录755；密钥与分享配置600。

## 记录流程

收到工作文字或图片时，先读取实际内容，再确定项目、日期与时间；不推测缺失信息。历史正文只追加补充，不删除或改写。

正式记录与待办联动优先使用 CLI：

```bash
npm run record -- add --file input.json --dry-run
npm run record -- add --file input.json
npm run record -- check --json
npm run record -- done "事项名" --note "完成说明"
npm run query -- --project example --todo --status open
```

`add` 一次处理当日条目、原附件、索引和待办；`done`同步完成标记、说明和当日日记录；网页完成、进度首次到100与CLI共用 `day-index.ts` 同步索引，保留已有概要且不重复登记；写后校验。去重/回顾用 query 的结构化过滤，而不是裸grep业务正文。概要可显式使用AI `record summary`，未配置不调用。

每日模板：

```markdown
# YYYY-MM-DD 工作记录

- **项目**：示例项目
- **系统**：演示系统

> 概要：一句话说明做了什么

## HH:MM 条目标题

- **类型**：需求
- **模块**：入门示例
- **内容**：用户提供的事实
- **待办**：后续事项（没有则省略）
- **附件**：
  ![图片说明](attachments/HHMM-01.png)

---
```

类型只有：待排查、需求、修改、优化；类型与模块必须清晰记录。概要汇总只讲做了什么，不额外罗列具体完成时间点。

## 待办权威格式

`todo.md` 是全库统一待办，`## 未完成` / `## 已完成`，项目分组为 `### <项目名> · <系统>`。主行必须单行，字段一律**全角冒号 `：`**。

```markdown
- [ ] 事项 —— 说明 | 优先级：中 | 进度：50 | 预计开始：YYYY-MM-DD | 预计完成：YYYY-MM-DD | 类型：需求 | 来源：[YYYY-MM-DD HH:MM](projects/<slug>/daily/YYYY-MM/YYYY-MM-DD/YYYY-MM-DD.md#锚点)
```

- 进度0–100整数，0–99未完成、100已完成。缺字段时未勾默认0、已勾默认100；显式数字必须与勾选一致，修改数字同步复选框及完成日期。
- 普通编辑保留状态与子块；100→降低重新打开，完成说明/附件/反馈/回复保留；完成按钮→100，取消→0。
- 完成标记 `**已于 YYYY-MM-DD HH:MM 完成**` 放说明段；展示层分拆成独立时间，不改原存储标记。
- 预计开始不得晚于预计完成，缺省日期与优先级可不输出。不凭模糊措辞或模块验收进度猜测待办百分比。
- 历史反馈不覆盖；同一反馈的管理员回复允许替换。删除/换项目需处理整个缩进子块，不只主行。
- 子块缩进：完成说明/附件/反馈2格，图片与回复4格，回复图片6格。图片引用按真实数据根相对路径。
- 站点完成可就地勾选，解析按勾选而非物理分区判断。助手整理可整体移入已完成，保留来源和子块。
- 同一事项仅保留一条，重复反馈附更新时间。新事项用户没给排期时建议补优先级/预计日期，确认后才写。

## 访问、渲染与分享

- 单管理员签名会话，未配置口令/签名密钥不会降级为公开所有内容。
- 公共首页只返回统计与项目名。记录、待办、收件箱、设置、附件需登录。
- 单项目分享公开授权项目待办、模块验收、只读排期和待办实际引用的图片。全库分享授权所有项目待办与排期，但当前不聚合模块清单。
- 分享edit仅原勾选完成与反馈，进度只读；分享勾选不追加日记录。分享URL含bearer token，不写请求日志，不传播到无关服务。
- 附件必须校验slug、真实日期、文件名、真实路径边界；分享附件仅允许授权待办引用的支持格式图片，不读记录Markdown、模块文件或无关附件。
- Markdown HTML只能经 `render-markdown.ts`净化后返回。不要直接将裸marked结果赋给dangerouslySetInnerHTML。新增外链/图片路径需保持访问边界。
- IP限流不无条件信任X-Forwarded-For；仅显式可信代理IP/CIDR启用代理信任。

## 可选外部服务与自动化

AI、Webhook默认为空。只有主动配置/使用后发送工作内容到用户指定服务；不得暗中发送或用真实内容测试外部接口。

Agent默认off；整理已完成待办时必须保留其显式项目/系统分组，不能按旧来源覆盖迁移后的归属，也不能改变原已完成项的归属。L1/dry只提出记录写入建议但仍会有AI调用与本地运行日志。L2需显式允许数据快照、独立私有数据Git仓库和成功快照后才执行绿色操作。黄色转人工，红色不提供工具。失败只恢复该数据仓库明确路径，不回退源码库。

`WORKNOTE_SYSTEMD=1`才允许页面操作固定单元，默认保存晨报时间只写配置并说明需外部调度；不要碰当前主机已有的生产systemd服务。`WORKNOTE_GIT_SNAPSHOT=1`才快照，限定数据根自身.git和数据路径，不add整个源码、不push。

## 开发与验收

- Node22.12+，React18、Vite8、Tailwind3、HeadlessUI2，Fastify5、TypeScript。新增代码匹配周围命名与注释密度。
- UI使用一个accent主色与中性灰、类型同色相t1–t4；danger仅逾期。复用 `client/src/index.css` 的 `.btn-*`、`.input`、`.tag`、`.card` 等。
- `npm run setup` → `npm run build`；写Markdown无需构建，改前端/后端需构建并重启相应进程。
- `npm test`、`npm run check`、`npm run build`，只使用隔离夹具；不运行生产Agent、不发真实通知。CI 的记录校验必须先对临时数据根运行 `npm run init -- --no-env`，再执行 `record check`，不使用生产目录。
- PWA系统分享必须等文字、全部图片及就绪标记写完缓存后才跳转；页面完整读取并填入表单成功后才能删除缓存，失败时保留并提示重试。
- 页面变更需真实浏览器点击/截图验证登录、项目选择、待办状态、分享、深链。只有HTTP200或类型通过不算交互验收；工具缺失要如实报告。
- 发布前按源码白名单检查实际git文件和初始历史。真实工作库保留私有，不把其.git复制到开源目录。
