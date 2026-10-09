# Token Sift 产品说明

Token Sift 是一个本地运行的命令行工具和 JavaScript/TypeScript 库，用于检查提示词、消息数组和工具定义中的 token 冗余。它定位文本区域，说明问题并给出可节省 token 的修改建议；支持安全修复的发现也可由命令行应用修复。

## 功能

- 对输入执行确定性的本地分析，默认运行内置规则。
- 显示每条发现的严重级别、位置、修改建议、当前 token 数、修后 token 数和节省量。
- 对支持的模型展示每次和每千次调用的估算成本。
- 支持单文件、多文件、通配符和标准输入，并可输出 JSON、Markdown 等报告格式。
- 可生成项目配置和集成参考片段，支持基线、预算和 CI 检查。
- 提供 JavaScript/TypeScript API、动态内容标记、自定义规则和测试断言工具。
- Claude 模型的 token 数和由其推导的数字一律标注为“估算”，不称为精确值。

## 使用

安装：

```sh
npm install --global @yuhond/token-sift
```

初始化当前项目并分析提示词文件：

```sh
token-sift init --model gpt-4o
token-sift "prompts/**/*.md" --model gpt-4o
```

配置写入 `token-sift.config.json`，本地基线、预算和其他运行数据写入 `.token-sift/`。也可通过管道分析文本：

```sh
printf 'Summarize this prompt.' | token-sift --stdin --model gpt-4o
```

以 JSON 导出分析结果，或让命令检查基线和预算：

```sh
token-sift prompts/example.md --model gpt-4o --format json
token-sift check prompts/*.md --model gpt-4o
```

在代码中使用：

```ts
import { analyze } from "@yuhond/token-sift";

const result = analyze(prompt, { model: "gpt-4o" });
```

## 20 条提示词分析规则（另有 2 条 CI 门禁规则）

内置规则识别以下 20 类常见问题：

1. `base64-blob`：提示词中内嵌 Base64 数据。
2. `high-entropy-string`：难以压缩的随机字符串。
3. `digit-fragmentation`：数字与时间戳的低效表示。
4. `duplicate-message-content`：消息之间重复的内容。
5. `filler`：不增加指令信息的填充语。
6. `row-json`：重复对象键导致的表格型 JSON 冗余。
7. `long-keys`：大量重复出现的长字段名。
8. `redundant-structure`：以不同形式重复表达的相同数据。
9. `verbose-schema-values`：枚举值中重复的长前缀。
10. `dead-instruction`：指向不存在内容的指令。
11. `unlabeled-dynamic`：未标记的动态 JSON 内容。
12. `html-whitespace`：HTML 中可压缩的排版空白。
13. `encoder-mismatch`：配置模型与分词器不匹配。
14. `cache-buster`：动态内容放在静态缓存内容之前。
15. `below-cache-minimum`：静态前缀未达到缓存所需长度。
16. `whitespace-run`：确实增加 token 数的长空白段。
17. `pretty-json`：格式化 JSON 中可移除的空白。
18. `repeated-block`：提示词内逐字重复的文本块。
19. `unicode-punct`：可替换为简单字符的特殊标点。
20. `uuid-bloat`：可在请求外映射为短标识符的 UUID。

规则严重级别可以在配置文件或命令行调整；也可以选择规则子集。

## 隐私

分析在本地执行，不上传代码或提示词；没有遥测、账号或后台网络请求。只有用户显式运行价格刷新或校准命令时才会联网。校准请求发送用户提供的样本到对应服务；日常分析不会发送输入内容。
