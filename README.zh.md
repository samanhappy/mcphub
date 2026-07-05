# MCPHub：一站式 MCP 服务器聚合平台

[English](README.md) | [Français](README.fr.md) | 中文版

MCPHub 通过将多个 MCP（Model Context Protocol）服务器组织为灵活的流式 HTTP（SSE）端点，简化了管理与扩展工作。系统支持按需访问全部服务器、单个服务器或按场景分组的服务器集合。

![控制面板预览](assets/dashboard.zh.png)

## 🌐 在线文档与演示

- **文档地址**: [docs.mcphub.app](https://docs.mcphub.app/)
- **演示环境**: [demo.mcphub.app](https://demo.mcphub.app/)

## 🚀 功能亮点

- **集中式管理** - 在统一控制台中监控和管理所有 MCP 服务器
- **灵活路由** - 通过 HTTP/SSE 访问所有服务器、特定分组或单个服务器
- **细粒度分组可见性** - 在分组中可独立控制每个服务器的 Tool、Prompt 与 Resource 是否对外暴露
- **智能路由** - 基于向量语义搜索的 AI 工具发现 ([了解更多](https://docs.mcphub.app/zh/features/smart-routing))
- **工具结果压缩** - 在返回客户端前透明压缩大型文本工具输出
- **热插拔配置** - 无需停机即可添加、移除或更新服务器
- **OAuth 2.0 支持** - 客户端和服务端模式，实现安全认证 ([了解更多](https://docs.mcphub.app/zh/features/oauth))
- **社交一键登录** - 通过 Better Auth 集成支持 GitHub 和 Google 快捷登录（需启用数据库模式）
- **数据库模式** - 将配置存储在 PostgreSQL 中，适用于生产环境 ([了解更多](https://docs.mcphub.app/zh/configuration/database-configuration))
- **Docker 就绪** - 容器化部署，开箱即用

## 🔧 快速开始

### 配置

创建 `mcp_settings.json` 文件：

```json
{
  "mcpServers": {
    "time": {
      "command": "npx",
      "args": ["-y", "time-mcp"]
    },
    "fetch": {
      "command": "uvx",
      "args": ["mcp-server-fetch"]
    }
  }
}
```

📖 查看[配置指南](https://docs.mcphub.app/zh/configuration/mcp-settings)了解完整选项，包括 OAuth、环境变量等。

### Docker 部署

```bash
# 挂载自定义配置运行（推荐）
docker run -p 3000:3000 -v ./mcp_settings.json:/app/mcp_settings.json -v ./data:/app/data samanhappy/mcphub

# 或使用默认配置运行（仍建议挂载 ./data，避免容器删除后数据丢失）
docker run -p 3000:3000 -v ./data:/app/data samanhappy/mcphub
```

`samanhappy/mcphub` 提供两种镜像变体：

- **`latest`**（默认镜像）— 包含 Node.js/pnpm、Python、uv/uvx、Git、构建工具，覆盖大多数 MCP server 场景。
- **`latest-full`**（扩展镜像）— 在 `latest` 基础上增加 Rust 工具链（Cargo/rustc）、Docker Engine，以及 Playwright 浏览器（Chrome + Firefox，仅限 amd64）。适合需要运行 Rust MCP server 或容器嵌套的场景。镜像体积更大。

构建选项与 Docker-in-Docker 配置详见 [Docker 部署文档](https://docs.mcphub.app/zh/configuration/docker-setup)。

### 访问控制台

打开 `http://localhost:3000`，使用用户名 `admin` 登录。首次启动时，如果未设置 `ADMIN_PASSWORD` 环境变量，系统将自动生成随机密码并输出到服务器日志中。也可以预先设置密码：

```bash
# Docker：通过环境变量设置管理员密码
docker run -p 3000:3000 -e ADMIN_PASSWORD=your-secure-password samanhappy/mcphub
```

> **提示：** 首次登录后请及时修改管理员密码以确保安全。

> **无界面模式：** 设置 `DISABLE_WEB=true` 后，MCPHub 将不再提供内置控制台 UI，只保留后端/API 与 MCP 端点。适合直接通过 `mcp_settings.json` 管理服务的场景。

### 连接 AI 客户端

通过以下地址连接 AI 客户端（Claude Desktop、Cursor 等）：

```
http://localhost:3000/mcp           # 所有服务器
http://localhost:3000/mcp/{group}   # 特定分组
http://localhost:3000/mcp/{server}  # 特定服务器
http://localhost:3000/mcp/$smart    # 智能路由
http://localhost:3000/mcp/$smart/{group}  # 智能路由（特定分组）
```

> **安全提示**：MCP 端点默认需要身份验证，以避免意外暴露。若需对 MCP 端点开放匿名访问，请在密钥设置中关闭 **启用 Bearer 认证**。**免登录开关**仅影响仪表盘登录。仅建议在受信任环境中使用。

📖 查看 [API 参考](https://docs.mcphub.app/zh/api-reference)了解详细的端点文档。

### 终端管理

`mcphub` 同一个二进制兼任 CLI，无需额外安装。

```bash
mcphub login --url http://localhost:3000 --username admin
mcphub servers list
mcphub servers add fetch --type stdio --command uvx --arg mcp-server-fetch
mcphub tools list                              # 看有哪些 tool 可调
mcphub tools get fetch_url                     # 看必填参数和样例命令
mcphub call fetch_url url=https://example.com --json
mcphub keys create --name ci --access-type all
```

CLI 同样对接公共市场接口（`mcphub discover`、`mcphub install ...`），可对任意开启了 discovery 的 hub 做检索与一键安装。

📖 查看 [CLI 指南](https://docs.mcphub.app/zh/features/cli)了解全部子命令、profile 管理与 CI 用法。

## 📚 文档

| 主题                                                                           | 描述                         |
| ------------------------------------------------------------------------------ | ---------------------------- |
| [快速开始](https://docs.mcphub.app/zh/quickstart)                             | 5 分钟快速上手               |
| [配置指南](https://docs.mcphub.app/zh/configuration/mcp-settings)             | MCP 服务器配置选项           |
| [数据库模式](https://docs.mcphub.app/zh/configuration/database-configuration) | PostgreSQL 生产环境配置      |
| [OAuth](https://docs.mcphub.app/zh/features/oauth)                            | OAuth 2.0 客户端和服务端配置 |
| [智能路由](https://docs.mcphub.app/zh/features/smart-routing)                 | AI 驱动的工具发现            |
| [CLI 指南](https://docs.mcphub.app/zh/features/cli)                           | 终端管理与工具调用           |
| [Docker 部署](https://docs.mcphub.app/zh/configuration/docker-setup)          | Docker 部署指南              |

## 🧑‍💻 本地开发

```bash
git clone https://github.com/samanhappy/mcphub.git
cd mcphub
pnpm install
pnpm dev
```

本地开发默认使用 `admin` / `admin123`，并将可写配置副本保存到 `data/mcp_settings.dev.json`，仓库里的 `mcp_settings.json` 不包含默认凭证。

> Windows 用户需分别启动后端和前端：`pnpm backend:dev`，`pnpm frontend:dev`

📖 查看[开发指南](https://docs.mcphub.app/zh/development)了解详细设置说明。

## 🔍 技术栈

- **后端**：Node.js、Express、TypeScript（ESM）
- **前端**：React、Vite、Tailwind CSS
- **存储**：默认基于文件的 `mcp_settings.json`；可选 PostgreSQL（TypeORM + pgvector，用于智能路由）
- **认证**：本地账号使用 JWT + bcrypt；支持 Bearer Key、内置 OAuth 2.0 服务端（`@node-oauth/oauth2-server`），以及可选的 Better Auth（GitHub/Google 一键登录）
- **协议**：Model Context Protocol SDK

## 👥 贡献指南

欢迎加入企微交流共建群，由于群人数限制，有兴趣的同学可以扫码添加管理员为好友后拉入群聊。

<img src="assets/wexin.png" width="350">

如果觉得项目有帮助，不妨请我喝杯咖啡 ☕️

<img src="assets/reward.png" width="350">

## 致谢

感谢以下朋友的赞赏：小白、唐秀川、琛、孔、黄祥取、兰军飞、无名之辈、Kyle，以及其他匿名支持者。

## 🌟 Star 历史趋势

[![Star History Chart](https://api.star-history.com/svg?repos=samanhappy/mcphub&type=Date)](https://www.star-history.com/#samanhappy/mcphub&Date)

## 📄 许可证

本项目采用 [Apache 2.0 许可证](LICENSE)。
