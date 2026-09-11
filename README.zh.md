# MCPHub

> 开源、自托管的 MCP 网关与控制平面，用于连接、控制和运行 MCP 服务器。

[![CI](https://github.com/samanhappy/mcphub/actions/workflows/ci.yml/badge.svg)](https://github.com/samanhappy/mcphub/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@samanhappy/mcphub)](https://www.npmjs.com/package/@samanhappy/mcphub)
[![Docker pulls](https://img.shields.io/docker/pulls/samanhappy/mcphub)](https://hub.docker.com/r/samanhappy/mcphub)
[![License](https://img.shields.io/github/license/samanhappy/mcphub)](LICENSE)
[![Discord](https://img.shields.io/badge/discord-join-5865F2?logo=discord&logoColor=white)](https://discord.gg/2BJehJZVH5)
[![GitHub stars](https://img.shields.io/github/stars/samanhappy/mcphub?style=social)](https://github.com/samanhappy/mcphub/stargazers)

[English](README.md) | [Français](README.fr.md) | 中文版

MCPHub 是 AI 客户端与 MCP 服务器之间的统一控制点。一次连接本地和远程 MCP 服务器，通过稳定端点组织和路由其能力，借助身份认证、限定作用域的凭据和用户级可见性控制访问，并通过集中日志、活动追踪和健康监控统一运行与管理。

兼容 Claude Code、Cursor、Cherry Studio、OpenWebUI 及其他支持 MCP 的应用。

![控制面板预览](assets/dashboard.zh.png)

## 🌐 官网、演示与文档

- **官网**: [mcphub.app](https://www.mcphub.app/zh)
- **文档**: [docs.mcphub.app](https://docs.mcphub.app/)
- **演示环境**: [demo.mcphub.app](https://demo.mcphub.app/)

## 🚀 功能亮点

### 一次连接，随处暴露

- **智能路由** ⭐ - 基于向量语义搜索的 AI 工具发现 ([了解更多](https://docs.mcphub.app/zh/features/smart-routing))
- **统一 MCP 网关** - 通过稳定的 MCP 端点暴露所有已连接的服务器，也支持分组和单服务器路由
- **服务器别名与路由** - 设置别名，并将客户端路由到所有服务器、指定分组、单个服务器或智能路由
- **SSE / Streamable HTTP / stdio 支持** - 通过支持的传输方式连接本地和远程 MCP 服务器
- **热插拔配置** - 无需停机即可添加、移除或更新服务器

### 管控访问与凭据

- **个人凭据** ⭐ - 一个共享服务器支持每位用户独立绑定密钥，加密保存并隔离 stdio 运行进程（[了解更多](docs/zh/features/per-user-credentials.mdx)）
- **身份认证与访问控制** - 使用 OAuth 2.0、Bearer Key 以及服务器或分组可见性控制访问权限
- **OAuth 2.0 支持** ⭐ - 客户端和服务端模式，实现安全认证 ([了解更多](https://docs.mcphub.app/zh/features/oauth))
- **社交一键登录** - 通过 Better Auth 集成支持 GitHub 和 Google 快捷登录（需启用数据库模式）
- **服务器与分组管理** - 组织服务器分组，管理可见性，并控制 Tool、Prompt 与 Resource 的暴露范围

### 稳定运行

- **日志与可观测性** - 查看工具调用活动、请求状态、延迟和服务器日志
- **健康检查** - 在一个地方监控连接健康状况和服务器状态
- **Web 控制台** - 通过浏览器管理服务器配置和运行状态
- **工具结果压缩** - 在返回客户端前透明压缩大型文本工具输出
- **数据库模式** - 将配置存储在 PostgreSQL 中，适用于生产环境 ([了解更多](https://docs.mcphub.app/zh/configuration/database-configuration))
- **Docker 就绪** - 容器化部署，开箱即用

## 🔧 快速开始

### 前置条件

- **Node.js** `^18.0.0 || >=20.0.0`（CI 使用 Node 20）
- **pnpm** `10.12.4`（见 `package.json` 声明）
- **Docker**（可选，用于容器化部署）

### 30 秒运行

```bash
docker run -p 3000:3000 -v ./data:/app/data -e MCPHUB_SETTING_PATH=/app/data/mcp_settings.json samanhappy/mcphub
```

打开 `http://localhost:3000`，使用用户名 `admin` 登录。首次启动时，如果未设置 `ADMIN_PASSWORD` 环境变量，系统将自动生成随机密码并输出到服务器日志中。

配置、用户和凭据绑定都会持久化到 `./data`（通过 `MCPHUB_SETTING_PATH`）。

想用自己的服务器？编写 `mcp_settings.json`（见[配置](#配置)），拷贝到 `./data/` 下，用同一条命令运行：

```bash
cp mcp_settings.json data/
docker run -p 3000:3000 -v ./data:/app/data -e MCPHUB_SETTING_PATH=/app/data/mcp_settings.json samanhappy/mcphub
```

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

可复制的命令见[30 秒运行](#30-秒运行)。请始终挂载 `./data` 并设置 `-e MCPHUB_SETTING_PATH=/app/data/mcp_settings.json`，这样配置、用户和凭据绑定在容器重建后不会丢失。

`samanhappy/mcphub` 提供两种镜像变体：

- **`latest`**（默认镜像）— 包含 Node.js/pnpm、Python、uv/uvx、Git、构建工具，覆盖大多数 MCP server 场景。
- **`latest-full`**（扩展镜像）— 在 `latest` 基础上增加 Rust 工具链（Cargo/rustc）、Docker Engine，以及 Playwright 浏览器（Chrome + Firefox，仅限 amd64）。适合需要运行 Rust MCP server 或容器嵌套的场景。镜像体积更大。

构建选项与 Docker-in-Docker 配置详见 [Docker 部署文档](https://docs.mcphub.app/zh/configuration/docker-setup)。

### 访问控制台

打开 `http://localhost:3000`（登录方式见[30 秒运行](#30-秒运行)）。也可以预先设置密码：

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

## 🏢 生产支持

正在生产环境使用 MCPHub？

可以直接与维护者合作，解决生产架构、OAuth/OIDC、身份与访问控制、
凭据管理、审计、Kubernetes 和高可用准备等问题。

[讨论 Production Pilot →](https://www.mcphub.app/zh/pricing)

## 👥 贡献指南

欢迎加入企微交流共建群，由于群人数限制，有兴趣的同学可以扫码添加管理员为好友后拉入群聊。

<img src="assets/wexin.png" width="350">

如果觉得项目有帮助，不妨请我喝杯咖啡 ☕️

<img src="assets/reward.png" width="350">

海外用户可通过 [ko-fi](https://ko-fi.com/samanhappy) 支持。

## 致谢

感谢以下朋友的赞赏：小白、唐秀川、琛、孔、黄祥取、兰军飞、无名之辈、Kyle，以及其他匿名支持者。

## 🌟 Star 历史趋势

[![Star History Chart](https://star-history.dera.page/svg?repos=samanhappy/mcphub&type=Date)](https://star-history.dera.page/#samanhappy/mcphub&Date)

## 📄 许可证

本项目采用 [Apache 2.0 许可证](LICENSE)。
