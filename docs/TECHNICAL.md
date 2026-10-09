# Token Sift 技术说明

## 执行流程

Token Sift 将输入文本或消息结构交给分析引擎。引擎根据模型选择对应分词器，构建分析上下文，并执行内置规则。规则返回发现项及其文本位置、严重级别、说明、修复建议和 token 估算；CLI 将结果渲染为终端文本或结构化报告。

支持把提示词作为字符串、消息数组或工具定义传入。JavaScript/TypeScript API、CLI 和测试断言使用相同的分析规则。

## 模型与数字可信度

支持的 OpenAI 模型使用对应的分词器编码。Claude 模型没有可供本工具使用的公开 BPE 词表，因此基于校准数据给出估算；相关发现标记为 `estimate`，不得解释为精确结果。其他未支持的模型不会静默套用不匹配的编码。

## 命令与本地数据

可执行命令名为 `token-sift`。项目配置文件是 `token-sift.config.json`；CLI 管理的基线、预算、校准及本地覆盖数据位于 `.token-sift/`。这两个路径与原项目的配置和数据路径隔离。命令行参数优先于配置文件中的对应设置。

CLI 支持单文件、多文件、glob 和标准输入，可输出终端报告、JSON、Markdown、GitHub Actions 注释及 SARIF。可选的安全修复由 `--write` 应用。基线和预算检查适合接入 CI。

## 20 条内置提示词分析规则（另有 2 条 CI 门禁规则）

提示词分析规则及其实现标识如下：

| 标识 | 检查内容 |
| --- | --- |
| `base64-blob` | 内嵌 Base64 数据 |
| `high-entropy-string` | 高熵字符串 |
| `digit-fragmentation` | 数字或时间戳表示 |
| `duplicate-message-content` | 重复消息内容 |
| `filler` | 填充用语 |
| `row-json` | 行式 JSON 冗余 |
| `long-keys` | 重复长字段名 |
| `redundant-structure` | 重复数据结构 |
| `verbose-schema-values` | 枚举值重复前缀 |
| `dead-instruction` | 无效内容引用 |
| `unlabeled-dynamic` | 未标记的动态 JSON 区域 |
| `html-whitespace` | HTML 空白 |
| `encoder-mismatch` | 模型与分词器不匹配 |
| `cache-buster` | 动态内容破坏静态前缀缓存 |
| `below-cache-minimum` | 静态前缀过短 |
| `whitespace-run` | 可压缩空白段 |
| `pretty-json` | 格式化 JSON 空白 |
| `repeated-block` | 重复文本块 |
| `unicode-punct` | 特殊标点 |
| `uuid-bloat` | UUID 冗余 |

另有基线回退和预算超限的 CI 检查，用于发现输入变化或超出配置上限。

## 联网与隐私边界

分析、分词、规则执行、报告生成和安全修复均在本地完成，不会上传代码或提示词，也不执行遥测或后台请求。只有显式执行价格数据刷新或 Claude 校准命令时才访问网络。校准会将用户提供的样本提交到模型提供方的 token 计数接口；返回结果用于本地校准数据。价格数据刷新获取公开的模型数据，并保存到 `.token-sift/`。
