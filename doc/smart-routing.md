# 智能工具发现，精准调用：MCPHub 智能路由重新定义 AI 工具选择

## 概述

在现代 AI 应用中，随着 MCP 服务器数量的快速增长和工具种类的日益丰富，如何从数百个可用工具中快速找到最适合当前任务的工具，成为了一个日益突出的挑战。传统方式下，AI 助手要么被迫处理所有可用工具的庞大列表，导致 token 消耗激增和响应延迟，要么依赖开发者手动分组，缺乏灵活性和智能化。MCPHub 的智能路由功能基于向量语义搜索技术，实现了自然语言驱动的工具发现与精准推荐，让 AI 助手能够像人类专家一样，根据任务描述智能地选择最合适的工具组合，大幅提升工作效率和用户体验。

## 智能路由是什么

### 技术原理

智能路由是 MCPHub 的核心创新功能，它基于现代向量语义搜索技术，将每个 MCP 工具的描述、参数和功能特征转换为高维向量表示。当用户提出任务需求时，系统将需求同样转换为向量，通过计算向量间的余弦相似度，快速定位最相关的工具集合。这种方法不依赖精确的关键词匹配，而是理解语义层面的相关性，能够处理自然语言的模糊性和多样性。

### 核心组件

**向量嵌入引擎**：支持 OpenAI text-embedding-3-small、BGE-M3 等多种主流嵌入模型，将工具描述转换为 1536 维或 1024 维向量表示，捕获工具功能的语义特征。

**PostgreSQL + pgvector 数据库**：采用业界领先的向量数据库解决方案，支持高效的向量索引和相似度搜索，能够在毫秒级时间内从大量工具中找到最相关的候选。

**动态阈值算法**：根据查询复杂度和具体程度自动调整相似度阈值，确保既不遗漏相关工具，也不引入无关噪声。简单查询使用较低阈值（0.2）获得更多样化结果，具体查询使用较高阈值（0.4）确保精确匹配。

**两步工作流**：`search_tools` 负责工具发现，`call_tool` 负责工具执行，清晰分离发现和执行逻辑，提供更好的可控性和调试体验。

## 为什么要使用智能路由

### 1. 解决工具选择的认知负荷

- **信息过载问题**：当 MCP 服务器数量超过 10 个、工具总数超过 100 个时，AI 助手面临严重的信息过载，难以在合理时间内做出最优选择。
- **智能路由优势**：通过语义搜索将候选工具缩减到 5-10 个最相关的选项，让 AI 助手能够专注于理解和使用最合适的工具，而不是被迫处理庞大的工具清单。

### 2. 大幅降低 Token 消耗

- **传统方式的成本**：向 AI 模型传递完整的工具列表会消耗大量 token，特别是当工具描述详细时，单次请求可能消耗数千 token。
- **智能路由的效益**：只传递最相关的工具信息，通常可以将工具相关的 token 消耗降低 70-90%，显著减少 API 调用成本，特别是在频繁交互的场景中。

### 3. 提升工具使用的准确性

- **语义理解能力**：智能路由能够理解"图片处理"、"数据分析"、"文档转换"等抽象概念，将其映射到具体的工具实现，避免了传统关键词匹配的局限性。
- **上下文感知**：考虑工具的输入输出模式和使用场景，推荐最适合当前任务流程的工具组合。

![智能路由工作原理](../assets/smart-routing-flow.png)

## 如何使用智能路由

### 配置智能路由

#### 1. 数据库配置

智能路由需要 PostgreSQL 数据库支持 pgvector 扩展：

```bash
# 使用 Docker 快速启动支持 pgvector 的 PostgreSQL
docker run --name mcphub-postgres \
  -e POSTGRES_DB=mcphub \
  -e POSTGRES_USER=mcphub \
  -e POSTGRES_PASSWORD=your_password \
  -p 5432:5432 \
  -d pgvector/pgvector:pg16
```

#### 2. 在 MCPHub 控制台配置智能路由

访问 MCPHub 设置页面（http://localhost:3000/settings），在"智能路由配置"部分填写：

- **数据库 URL**：`postgresql://mcphub:your_password@localhost:5432/mcphub`
- **OpenAI API Key**：您的 OpenAI API 密钥
- **API Base URL**：可选，默认为 `https://api.openai.com/v1`
- **嵌入模型**：推荐使用 `text-embedding-3-small`（1536 维，性价比最佳）

![智能路由配置界面](../assets/smart-routing-config.png)

#### 3. 启用智能路由

配置完成后，开启"启用智能路由"开关。系统将自动：

- 为所有已连接的 MCP 服务器工具生成向量嵌入
- 建立向量索引以支持快速搜索
- 在后续新增工具时自动更新向量数据库

### 智能工具发现的使用方式

启用智能路由后，MCPHub 会自动提供两个核心工具：

#### search_tools - 智能工具搜索

```typescript
// 使用示例
{
  "name": "search_tools",
  "arguments": {
    "query": "help me process images and resize them", // 自然语言查询
    "limit": 10 // 返回结果数量
  }
}
```

**查询策略建议**：

- **宽泛查询**：使用较高的 limit（20-30），如"数据处理工具"
- **精确查询**：使用较低的 limit（5-10），如"将 PNG 图片转换为 WebP 格式"
- **分步查询**：复杂任务可以分解为多个具体查询

#### call_tool - 精准工具执行

```typescript
// 使用示例
{
  "name": "call_tool",
  "arguments": {
    "toolName": "image_resize", // 从 search_tools 结果中获取的工具名
    "arguments": { // 根据工具的 inputSchema 提供参数
      "input_path": "/path/to/image.png",
      "width": 800,
      "height": 600
    }
  }
}
```

### 实际应用场景演示

#### 场景 1：图像处理工作流

```markdown
用户请求：我需要批量处理一些产品图片，调整大小并转换格式

AI 工作流：

1. search_tools("image processing batch resize convert format")
   → 返回：image_batch_processor, format_converter, image_optimizer
2. call_tool("image_batch_processor", {...})
   → 执行批量图像处理
```

#### 场景 2：数据分析任务

```markdown
用户请求：分析这个 CSV 文件的销售数据，生成可视化图表

AI 工作流：

1. search_tools("CSV data analysis visualization charts")
   → 返回：csv_analyzer, chart_generator, statistics_calculator
2. call_tool("csv_analyzer", {"file_path": "sales.csv"})
3. call_tool("chart_generator", {"data": analysis_result})
```

#### 场景 3：文档处理流水线

```markdown
用户请求：将 Word 文档转换为 PDF，然后提取其中的文本内容

AI 工作流：

1. search_tools("document conversion Word to PDF")
   → 返回：doc_converter, pdf_generator
2. call_tool("doc_converter", {"input": "document.docx", "output_format": "pdf"})
3. search_tools("PDF text extraction")
   → 返回：pdf_text_extractor, ocr_processor
4. call_tool("pdf_text_extractor", {"pdf_path": "document.pdf"})
```

### 高级配置选项

#### 多模型支持

智能路由支持多种嵌入模型，可根据需求选择：

```json
{
  "embeddingModel": "text-embedding-3-small", // OpenAI，1536维，平衡性能和成本
  "embeddingModel": "text-embedding-3-large", // OpenAI，3072维，最高精度
  "embeddingModel": "bge-m3" // 开源模型，1024维，支持多语言
}
```

#### 自定义 API 端点

支持使用自建的嵌入服务或其他 OpenAI 兼容的 API：

```json
{
  "openaiApiBaseUrl": "https://your-api-endpoint.com/v1",
  "openaiApiKey": "your-custom-api-key"
}
```

## 性能优化与最佳实践

### 查询优化策略

**分层查询**：对于复杂任务，使用从宽泛到具体的查询策略：

```
1. 宽泛查询："文档处理工具" (limit: 20)
2. 具体查询："PDF 转 Word 转换器" (limit: 5)
```

**上下文相关性**：在查询中包含任务上下文信息：

```
好：search_tools("为电商网站批量压缩产品图片")
较好：search_tools("图片压缩工具")
```

**动态调整**：根据返回结果质量动态调整查询词和限制数量。

### 数据库性能调优

**索引优化**：智能路由自动创建最优的向量索引：

```sql
CREATE INDEX idx_vector_embeddings_embedding
ON vector_embeddings USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);
```

**内存配置**：对于大规模部署，建议增加 PostgreSQL 内存配置：

```
shared_buffers = 256MB
effective_cache_size = 1GB
work_mem = 64MB
```

### 监控与调试

**相似度阈值监控**：观察搜索结果的相似度分数，调整阈值以获得最佳效果。

**查询效果分析**：定期检查常用查询的返回结果，优化工具描述以提高搜索准确性。

## 智能路由的技术优势

### 语义理解能力

与传统的关键词匹配相比，智能路由能够理解：

- **同义词和近义词**："图片"和"图像"、"转换"和"变换"
- **上下层级概念**："数据可视化"包含"图表生成"、"统计图绘制"等
- **任务意图推理**："我要做一个数据报告"自动关联数据分析、图表生成、文档创建等工具

### 多语言支持

智能路由支持中英文混合查询，能够处理：

```
search_tools("图片 resize 和 format conversion")
search_tools("将文档转换为 PDF 格式")
search_tools("image processing and 格式转换")
```

### 容错能力

具备一定的容错能力，能够处理：

- 拼写错误：自动纠正常见拼写错误
- 模糊描述：从不完整的描述中推导完整意图
- 领域术语：理解特定领域的专业术语

## 结语

MCPHub 的智能路由功能代表着 MCP 生态系统向智能化方向发展的重要一步。通过引入向量语义搜索技术，它不仅解决了工具数量激增带来的选择困难，更为 AI 助手提供了类似人类专家的工具发现和选择能力。

随着 MCP 服务器生态的不断丰富，智能路由将成为连接用户需求与丰富工具资源的关键桥梁。它让开发者无需担心工具管理的复杂性，让用户享受到更加智能和高效的 AI 助手体验。

未来，我们还将继续优化智能路由的算法，引入更多先进的 AI 技术，如基于强化学习的工具推荐、多模态工具理解等，为 MCP 生态系统注入更强的智能化动力。

智能路由不仅仅是一个技术功能，更是 MCPHub 对于"让 AI 工具使用变得简单而智能"这一愿景的具体实现。在这个工具爆炸的时代，智能路由让我们重新定义了 AI 与工具的交互方式。

项目地址：https://github.com/samanhappy/mcphub

![智能路由架构图](../assets/smart-routing-architecture.png)
