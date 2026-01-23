# MCPHub：一站式 MCP 服务器聚合平台

[English](README.md) | [Français](README.fr.md) | 中文版

MCPHub 通过将多个 MCP（Model Context Protocol）服务器组织为灵活的流式 HTTP（SSE）端点，简化了管理与扩展工作。系统支持按需访问全部服务器、单个服务器或按场景分组的服务器集合。

![控制面板预览](assets/dashboard.zh.png)

## 🌐 在线文档与演示

- **文档地址**: [docs.mcphubx.com](https://docs.mcphubx.com/)
- **演示环境**: [demo.mcphubx.com](https://demo.mcphubx.com/)

## 🚀 功能亮点

- **集中式管理** - 在统一控制台中监控和管理所有 MCP 服务器
- **灵活路由** - 通过 HTTP/SSE 访问所有服务器、特定分组或单个服务器
- **智能路由** - 基于向量语义搜索的 AI 工具发现 ([了解更多](https://docs.mcphubx.com/zh/features/smart-routing))
- **热插拔配置** - 无需停机即可添加、移除或更新服务器
- **OAuth 2.0 支持** - 客户端和服务端模式，实现安全认证 ([了解更多](https://docs.mcphubx.com/zh/features/oauth))
- **社交一键登录** - 通过 Better Auth 集成支持 GitHub 和 Google 快捷登录（需启用数据库模式）
- **数据库模式** - 将配置存储在 PostgreSQL 中，适用于生产环境 ([了解更多](https://docs.mcphubx.com/zh/configuration/database-configuration))
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

📖 查看[配置指南](https://docs.mcphubx.com/zh/configuration/mcp-settings)了解完整选项，包括 OAuth、环境变量等。

### Docker 部署

```bash
# 挂载自定义配置运行（推荐）
docker run -p 3000:3000 -v ./mcp_settings.json:/app/mcp_settings.json -v ./data:/app/data samanhappy/mcphub

# 或使用默认配置运行
docker run -p 3000:3000 samanhappy/mcphub
```

### 访问控制台

打开 `http://localhost:3000`，使用默认账号登录：`admin` / `admin123`

### 连接 AI 客户端

通过以下地址连接 AI 客户端（Claude Desktop、Cursor 等）：

```
http://localhost:3000/mcp           # 所有服务器
http://localhost:3000/mcp/{group}   # 特定分组
http://localhost:3000/mcp/{server}  # 特定服务器
http://localhost:3000/mcp/$smart    # 智能路由
```

📖 查看 [API 参考](https://docs.mcphubx.com/zh/api-reference)了解详细的端点文档。

## 📚 文档

| 主题                                                                           | 描述                         |
| ------------------------------------------------------------------------------ | ---------------------------- |
| [快速开始](https://docs.mcphubx.com/zh/quickstart)                             | 5 分钟快速上手               |
| [配置指南](https://docs.mcphubx.com/zh/configuration/mcp-settings)             | MCP 服务器配置选项           |
| [数据库模式](https://docs.mcphubx.com/zh/configuration/database-configuration) | PostgreSQL 生产环境配置      |
| [OAuth](https://docs.mcphubx.com/zh/features/oauth)                            | OAuth 2.0 客户端和服务端配置 |
| [智能路由](https://docs.mcphubx.com/zh/features/smart-routing)                 | AI 驱动的工具发现            |
| [Docker 部署](https://docs.mcphubx.com/zh/configuration/docker-setup)          | Docker 部署指南              |

## 🧑‍💻 本地开发

```bash
git clone https://github.com/samanhappy/mcphub.git
cd mcphub
pnpm install
pnpm dev
```

> Windows 用户需分别启动后端和前端：`pnpm backend:dev`，`pnpm frontend:dev`

📖 查看[开发指南](https://docs.mcphubx.com/zh/development)了解详细设置说明。

## 🔍 技术栈

- **后端**：Node.js、Express、TypeScript
- **前端**：React、Vite、Tailwind CSS
- **认证**：JWT & bcrypt
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
