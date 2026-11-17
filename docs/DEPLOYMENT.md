# 部署与备份

## 1. 运行边界

- Node.js **22.12+**，推荐 Node.js 22 LTS；支持标准 Linux / Node 或 Docker。
- 一个数据目录仅运行一个 API 写进程。文件原子写不是跨进程锁，不能用 cluster / 多副本共享卷。
- 源码与数据分离：默认 `<repo>/data`，`WORKNOTE_ROOT` 可指定私有路径。API 和 CLI 使用同一根目录。
- 核心功能不依赖 nginx、服务器管理面板、systemd、AI 或 Webhook。后端可直接提供构建后的 SPA。

## 2. Node 方式

安装代码到自己选择的目录，以下命令在源码根运行：

```bash
npm run setup
npm run build
npm run init -- --data-dir /srv/worknote-data --project example --name "示例项目" --system "演示系统"
npm start
```

不要对已有数据目录运行删除命令。初始化只补缺失文件、添加项目，已有 Markdown 内容不覆盖。

`.env` 由初始化创建并限制为 `600`。进程环境优先于文件；`WORKNOTE_ENV_FILE` 指定其他文件时需预先创建该文件。后台服务应使用部署工具注入环境，或明确指定私有环境文件，不把密钥放在命令行 / git。

本机 HTTP 可设置 `WORKNOTE_SECURE_COOKIE=false`；公网必须使用 HTTPS，保持缺省 `true`。`HOST` 默认 `127.0.0.1`，端口默认 `8000`。

## 3. HTTPS 反向代理

以下 nginx 示例需替换域名和证书路径，先在本机验证后部署。它只是模板，不会自动配置证书：

```nginx
server {
    listen 443 ssl;
    server_name worknote.example.org;
    ssl_certificate /your/certificate/fullchain.pem;
    ssl_certificate_key /your/certificate/privkey.pem;
    client_max_body_size 30m;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        # Replace untrusted client forwarding headers.
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_read_timeout 190s;
    }
}
```

用 nginx 在本机代理时可在 `.env` 设置 `WORKNOTE_TRUST_PROXY=127.0.0.1,::1`。只填写实际可信的代理 IP / CIDR，不开放任意转发头信任。Docker 代理的来源地址可能不同，请按自己的网络填写。

默认公开总览的统计与项目名。若希望站点一切都私有，可在反向代理层增加统一鉴权。分享链接仍会受该外层鉴权影响。

## 4. Docker

参见根目录 `Dockerfile` 与 `compose.yaml`。镜像只包含程序和构建产物，不包含 `.env`、工作记录或 Git 历史；运行数据存放在独立 `/data` 卷。镜像启动前必须注入登录口令和签名密钥。

```bash
docker compose up -d --build
docker compose exec worknote npm run init -- --no-env --project example --name "示例项目" --system "演示系统"
```

停止使用 `docker compose down`；**`down -v` 会删除数据卷**，日常升级不要加 `-v`。镜像使用非 root 用户，需要绑定宿主目录时确保 UID 1000 可以读写数据目录；不要通过给所有文件 `777` 来解决权限。

## 5. 定时晨报

晨报 CLI 可由 cron、systemd 或自己的调度平台运行：

```bash
# 演练：仅本地输出，不发通知，不做git快照
npm run digest -- --no-send --no-git --json

# 正式运行：只有配置Webhook后才会发送
npm run digest
```

必须使用同一 `WORKNOTE_ROOT` 与环境配置。晨报时间设置在未启用 systemd 管理时只保存配置；需要同步调整实际调度器，页面不会声称定时器已生效。

systemd 页面控制是 Linux 高级选项，默认 `WORKNOTE_SYSTEMD=0`。开启后 API 使用固定单元名 `worknote-agent.service` 与 `worknote-digest.timer`，并尝试写入 `/etc/systemd/system/worknote-digest.timer.d/override.conf`。在自己的实例完成权限和单元配置后再开启；它不适合多实例，Docker 中保持关闭。不要赋予应用不受限制的 root 权限。

## 6. 可选整理 Agent 与私有快照

默认 Agent 为 `off`。L1 / dry 提供建议，不自动执行记录写入；它仍可能把观察内容发给配置的 AI，并在数据目录写运行日志。L2 可执行绿色写操作，黄色操作记录为人工确认。

L2 必须具备可回滚的**独立私有数据 Git 仓库**且显式设置 `WORKNOTE_GIT_SNAPSHOT=1`。源码库的 Git 历史不会作为数据快照使用：

```bash
# 仅在自己的私有数据目录初始化。切勿把该仓库公开。
git -C /srv/worknote-data init
git -C /srv/worknote-data config user.name "WorkNote Backup"
git -C /srv/worknote-data config user.email "backup@example.invalid"
```

数据初始化的 `.gitignore` 排除密钥、token 与缓存；快照进一步只跟踪明确的数据路径，不推送远端。备份仍可能包含客户截图和日志，必须私有。

```bash
npm run agent -- --level L1 --dry
# 确认AI、独立数据git与备份条件后才能运行L2
npm run agent -- --level L2
```

页面「立即运行」只有显式开启 systemd 且配置自己的服务时可用。普通 CLI 不依赖页面控制。

## 7. 备份、更新与恢复

- 保存 `WORKNOTE_ROOT` 全目录以及 `.env` / 外部私有环境文件的加密、访问受限备份。
- `site-config.json`、`shares.json` 含凭据；即使正文备份进私有 Git，也应另有受控凭据备份。
- 更新前停止写进程或保证没有并发写入，先备份；更新源码并 `npm run setup && npm run build` 后重启。
- Markdown 修改通常无需重启；配置文件 / 源码与环境变更的规则不同，见 README。
- 回退时保持代码与数据格式兼容。不要在生产目录运行测试或 Agent 演练。

数据文件默认 `644`、目录 `755`，密钥与分享配置 `600`。如果主机有其他不可信用户，使用更严格的数据父目录权限与专用用户隔离访问。

## 8. 首版不提供

不包含原部署域名的 APK、Digital Asset Links、签名材料、生产 nginx/systemd 文件和个人日志。PWA 是通用网站能力；如自行构建 Android TWA，需要自己的包名、域名、签名和 assetlinks 配置。
