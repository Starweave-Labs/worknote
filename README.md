# WorkNote

**用 Markdown 保存工作记录，用网页管理项目、待办与排期。**

WorkNote 是面向个人的自托管工作记录工具。每天的记录、待办、收件箱和模块验收都保存在可阅读的本地文件里，React 界面负责浏览和操作，Fastify API 负责解析与最小写入。修改 Markdown 后刷新页面即可看到变化，无需重建。

开源首版只包含通用程序与虚构示例。实际项目、截图、口令、分享链接和运行日志保存在独立的私有数据目录。

## 能做什么

- **工作记录**：按项目、月份、日期归档，支持时间轴、关键词检索、截图缩略图与灯箱。
- **待办**：列表 / 看板、优先级、0–100% 进度、完成说明、反馈回复；完成时追加当天工作记录。
- **排期**：月历、甘特图，可拖动起止日期。
- **项目模块**：父子两级验收清单与进度。
- **收件箱与汇报**：先捕获文字 / 截图，再整理；按日期生成 Markdown 汇报。
- **可撤销分享**：分享单项目或全库待办；只读或允许勾选完成与反馈，分享进度只读。单项目分享含模块验收；全库分享目前不聚合模块清单。
- **可选 AI**：通过自行配置的 OpenAI 兼容网关解析待办、整理完成说明、问答与起草概要。
- **CLI 与可选 Agent**：结构化检索、写入、校验、晨报和分级整理。
- **PWA**：可添加到主屏幕；支持系统分享文字 / 图片到收件箱的浏览器环境可使用分享目标。

目前面向**单管理员、单 Node 进程**部署；界面及 Markdown 字段为中文。项目名单是运行时配置，增加项目无需修改源码。

## 本地启动

需要 **Node.js 22.12+** 和 npm，推荐 Node.js 22 LTS。以下命令在仓库根目录运行：

```bash
npm run setup
npm run build
npm run init -- --project example --name "示例项目" --system "演示系统"
```

初始化会创建 `data/` 和权限为 `600` 的 `.env`，生成随机登录口令与签名密钥，并在终端显示新口令。已有记录不会被覆盖；重复添加同一项目不会重置数据。

本机用 HTTP 体验时，在生成的 `.env` 中设置：

```dotenv
WORKNOTE_SECURE_COOKIE=false
```

然后启动：

```bash
npm start
```

打开 **http://127.0.0.1:8000**，用初始化输出的口令登录。构建后的前端由同一个进程提供，无需额外 Web 服务器。部署公网时使用 HTTPS，并保持 `WORKNOTE_SECURE_COOKIE=true`。

如果只想要空库，运行 `npm run init`。之后添加项目：

```bash
npm run init -- --project my-project --name "我的项目" --system "工作记录"
```

项目配置在 `data/projects.json`，格式见 [examples/projects.json](examples/projects.json)。直接修改后刷新即可生效；项目 slug 创建后请保持稳定，变更已用名称需要同步既有待办分组和记录元数据。

## Docker Compose

```bash
cp .env.example .env
```

填写 `.env` 中的 `WORKNOTE_PASSWORD`，并用以下命令生成 `WORKNOTE_SECRET`：

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

本机 HTTP 体验需要 `WORKNOTE_SECURE_COOKIE=false`。然后：

```bash
docker compose up -d --build
docker compose exec worknote npm run init -- --no-env --project example --name "示例项目" --system "演示系统"
```

访问 http://127.0.0.1:8000。数据保存在 `worknote-data` 命名卷中；容器使用非 root 用户运行。Compose 默认只绑定本机端口，公网访问需配置 HTTPS 反向代理。不要执行 `docker compose down -v`，除非确实要删除数据卷。

## 写入记录与待办

网页可以创建待办、捕获收件箱文字和图片；正式每日记录可由 CLI 或支持读写本地文件的助手维护。

```bash
# 虚构示例：项目 example 已由前面初始化创建
npm run record -- add --file examples/record.json --dry-run
npm run record -- add --file examples/record.json
npm run record -- check --json

# 查询与完成
npm run query -- --project example --todo --status open
npm run record -- done "补充演示页面的操作提示" --note "已补充并验证。"
```

示例使用固定日期，仅用于演示。真实写入请使用实际日期。重复事项名会被拒绝，完成会保留反馈与历史信息。

数据布局：

```text
data/
├── projects.json          # 项目 slug、显示名、默认系统
├── todo.md                # 全库统一待办
├── index.md               # 记录索引
├── inbox.md               # 未整理内容
├── inbox/attachments/
├── projects/<slug>/
│   ├── modules.md
│   └── daily/YYYY-MM/YYYY-MM-DD/
│       ├── YYYY-MM-DD.md
│       └── attachments/
├── shares.json            # 分享凭据，600，不公开
├── site-config.json       # 站点设置与密钥，600，不公开
└── agent/runs/            # 可选整理日志
```

Markdown 的字段分隔符使用**全角冒号 `：`**。`progress` 为 0–100 整数，100 与完成勾选同步；模块验收有独立状态语义。详细格式和维护约定见 [AGENTS.md](AGENTS.md)。

## 配置与可选功能

环境配置见 [.env.example](.env.example)，部署、反向代理、备份和定时任务见 [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)。

- `WORKNOTE_ROOT` 缺省 `data`；相对路径以仓库根目录解析。
- API 和 CLI 自动加载仓库 `.env`，现有进程环境优先。可用 `WORKNOTE_ENV_FILE=/私有路径/config.env` 显式指定；设为空字符串则不读取文件。
- 网站「设置」页写入数据目录的 `site-config.json`，其值优先于环境变量。改环境文件需重启进程，改站点覆盖即时生效。
- AI 默认不启用。自行配置网关地址、密钥与模型后，主动使用 AI 功能会向该网关发送所选文字 / 图片；启用整理 Agent 会发送检索与观察到的工作内容。
- 通知 Webhook 默认为空。填写后反馈通知、晨报会发送工作摘要到指定服务。
- Agent 默认 `off`；systemd 控制和 Git 数据快照均为显式选项。普通待办、记录、日历、分享功能不依赖它们。

默认公开首页提供统计数字和项目名称；记录、待办、附件需要登录。分享链接是访问凭据，持有者可以访问授权范围中的待办、模块验收、排期及待办引用图片。`_all` 全库分享会暴露所有项目的这些信息。详见 [SECURITY.md](SECURITY.md)。

## 开发与验证

```bash
npm run dev:api
npm run dev:web     # 另一个终端，默认 http://127.0.0.1:5173
npm test
npm run check
npm run build
```

Vite 的 API / 附件代理默认指向 `http://127.0.0.1:8000`，可通过 `WORKNOTE_API_URL` 改写。测试使用临时数据夹具与隔离 API 进程，不修改运行数据，不发送通知，不调用生产 Agent。

目录、路由与核心函数见 [CODE_INDEX.md](CODE_INDEX.md)。欢迎提交修复和功能改进，参与说明见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 许可证

项目原创代码使用 [MIT](LICENSE) 许可证。第三方依赖及其原生组件保留各自许可证，见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。发布包不包含任何个人或客户工作记录，也不包含特定站点的 Android APK、签名材料或部署配置。
