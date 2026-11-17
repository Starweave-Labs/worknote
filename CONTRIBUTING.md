# Contributing

欢迎改进 WorkNote。请先阅读 [README.md](README.md)、[AGENTS.md](AGENTS.md) 与 [CODE_INDEX.md](CODE_INDEX.md)。

1. 使用 Node.js 22.12+；运行 `npm run setup` 安装锁定依赖。
2. 用临时目录和虚构项目开发，不复制真实记录、截图、分享 token 或环境配置。
3. 保持 Markdown 存储格式与既有写入模块一致；新增写路径应复用 `todo-format.ts`、`todo-write.ts` 等权威模块。
4. 涉及行为变化时更新索引与文档，提供覆盖实际边界的回归测试。
5. 提交前运行 `npm test`、`npm run check`、`npm run build`。界面变化还需实际浏览器点击验证。

源码使用 React、TypeScript、Fastify 和 Tailwind。界面采用一个主色与中性灰阶，请优先复用 `client/src/index.css` 中已有按钮、输入、标签、卡片类。

Pull request 请说明触发场景、修改后的行为与验证方式。安全问题按 [SECURITY.md](SECURITY.md) 私下报告。贡献的原创代码以仓库 MIT 许可证提供。
