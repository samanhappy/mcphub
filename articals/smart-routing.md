# 无限工具，智能路由：MCPHub 引领 AI 工具使用新范式

## 概述

在现代 AI 应用中，随着 MCP 服务器数量的快速增长和工具种类的不断丰富，如何从数百个可用工具中快速定位最适合当前任务的工具，成为开发者和 AI 助手面临的一项重要挑战。

传统做法要么将所有工具暴露给 AI 助手处理，导致 token 消耗巨大、响应延迟严重；要么依赖开发者手动分组配置，灵活性和智能性不足。

MCPHub 推出的智能路由功能，基于向量语义搜索技术，实现了自然语言驱动的工具发现与精准推荐。它让 AI 助手能够像人类专家一样，根据任务描述自动选择最优工具组合，大幅提升了系统效率和用户体验。

## 什么是智能路由

### 技术原理

智能路由是 MCPHub 的核心功能之一。它将每个 MCP 工具的名称和描述嵌入为高维语义向量。当用户发起自然语言任务请求时，系统会将该请求也转换为向量，通过计算相似度，快速返回最相关的工具列表。

这一过程摒弃了传统的关键词匹配，具备更强的语义理解能力，能够处理自然语言的模糊性和多样性。

### 核心组件

- **向量嵌入引擎**：支持如 `text-embedding-3-small`、`bge-m3` 等主流模型，将文本描述转为语义向量。
- **PostgreSQL + pgvector**：使用开源向量数据库方案，支持高效的向量索引和搜索。
- **两步工作流分离**：
  - `search_tools`：负责语义工具发现
  - `call_tool`：执行实际工具调用逻辑

## 为什么需要智能路由

### 1. 减少认知负荷

- 当工具数量超过 100 个，AI 模型难以处理所有工具上下文。
- 智能路由通过语义压缩，将候选工具缩小至 5～10 个，提高决策效率。

### 2. 显著降低 token 消耗

- 传统做法传入全量工具描述，可能消耗上千 token。
- 使用智能路由，通常可将 token 使用降低 70～90%。

### 3. 提升调用准确率

- 理解任务语义：如“图片增强”→选择图像处理工具，而不是依赖命名关键词。
- 上下文感知：考虑输入/输出格式和工具组合能力，匹配更合理的执行链路。

## 智能路由配置指南

### 1. 启动支持 `pgvector` 的 PostgreSQL 数据库

```bash
docker run --name mcphub-postgres \
  -e POSTGRES_DB=mcphub \
  -e POSTGRES_USER=mcphub \
  -e POSTGRES_PASSWORD=your_password \
  -p 5432:5432 \
  -d pgvector/pgvector:pg17
```

如已部署 PostgreSQL，可直接创建数据库并启用 `pgvector` 扩展：

```sql
CREATE DATABASE mcphub;
CREATE EXTENSION vector;
```

### 2. 获取 embedding 模型的 API Key

前往 OpenAI 或其他提供商获取嵌入模型的 API Key。国内用户推荐使用硅基流动 `bge-m3` 免费模型，没有注册过的用户可以使用我的邀请链接：[https://cloud.siliconflow.cn/i/TQhVYBvA](https://cloud.siliconflow.cn/i/TQhVYBvA)。

### 3. 控制台配置

![配置](./assets/sr-conf.png)

在 MCPHub 控制台中，进入「智能路由」配置页面，填写以下信息：

- **数据库 URL**：`postgresql://mcphub:your_password@localhost:5432/mcphub`
- **OpenAI API Key** ：填写你获取的嵌入模型 API Key
- **OpenAI 基础 URL**：`https://api.siliconflow.cn/v1`
- **嵌入模型**：推荐使用 `BAAI/bge-m3`

开启「启用智能路由」后系统会自动：

- 对所有工具生成向量嵌入
- 构建向量索引
- 自动监听新增工具，更新索引

## 工具定义

### search_tools - 工具搜索

```ts
{
  "name": "search_tools",
  "arguments": {
    "query": "help me resize and convert images",
    "limit": 10
  }
}
```

### call_tool - 工具执行

```ts
{
  "name": "call_tool",
  "arguments": {
    "toolName": "image_resizer",
    "arguments": {
      "input_path": "/path/to/image.png",
      "width": 800,
      "height": 600
    }
  }
}
```

## 演示

下面我将通过几个示例来展示如何使用智能路由。

首先，我们需要在 mcphub 添加几个不同类型的 MCP 服务器：`amap`、`time-map`、`fetch`。

![添加服务器](./assets/sr-servers.png)

然后我们需要选择一个支持 MCP 的客户端，这里选择国产的 DeepChat，聊天模型选择 `Qwen3-14B`。

接着，在 DeepChat 中添加 mcphub 的智能路由端点：

![添加智能路由](./assets/sr-dc.png)

添加成功后，就可以在工具中看到 `search_tools` 和 `call_tool` 两个工具了：

![工具列表](./assets/sr-tools.png)

### 示例 1：地图导航

输入：从北京如何导航到上海。

结果：

![地图导航](./assets/sr-map-result.png)

可以看到，DeepChat 先调用了 `search_tools` 工具：

![搜索工具](./assets/sr-map-search.png)

然后再调用 `call_tool` 查询具体的导航信息：

![调用工具](./assets/sr-map-call.png)

### 示例 2：查询时间

输入：使用工具查询美国现在的时间是几点

结果：

![查询时间](./assets/sr-time.png)

需要说明的是，由于不同的模型对工具调用的支持程度不同，可能会出现一些差异。比如在这个例子中，为了提高准确性，我在输入中明确提到了“使用工具”。

### 示例 3：查看网页

输入：打开 baidu.com 看看有什么

结果：

![查看网页](./assets/sr-web.png)

可以看到，DeepChat 成功调用了工具，不过由于百度的 robots.txt 限制，无法获取到具体内容。

## 结语

借助 MCPHub 的智能路由功能，AI 助手能够更高效地处理复杂任务，显著减少不必要的 token 消耗，同时提升工具调用的准确性与灵活性。作为面向未来的 AI 工具发现与调用基础设施，智能路由不仅使 AI 更聪明地选择和组合工具，还为多 Agent 协同提供了清晰、可控且可扩展的底层能力支撑。

> MCPHub 只是我一时兴起开发的小项目，没想到收获了这么多关注，非常感谢大家的支持！目前 MCPHub 还有不少地方需要优化和完善，我也专门建了个交流群，感兴趣的可以添加下面的微信。

![微信](../assets/wexin.png)

> 同时，欢迎大家一起参与建设！项目地址为：[https://github.com/samanhappy/mcphub](https://github.com/samanhappy/mcphub)。
