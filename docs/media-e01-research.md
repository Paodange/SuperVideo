# E01 联网研究工具 V1

E01 只提供两个固定能力：`research.search` 和
`research.save_source`。它是 E02/E03 的来源记录底座，不是通用 HTTP
代理、网页爬虫、事实核验器或素材下载器。

## 合同与请求边界

合同版本为 `research-v1`，`schemaVersion` 固定为 `1`。两个请求都必须带：

- `projectId`：必须是当前已打开项目的 UUID；Core session 会再次检查，不能
  跨项目读取或写入；
- `requestId`：调用方业务请求标识；
- `idempotencyKey`：项目内幂等键；
- `schemaVersion` 和 `contractVersion`；
- `research.search` 的 `topic`、`audience`、`query`、`limit` 和有界
  `timeoutMs`；
- `research.save_source` 的完整 `source` 快照。

文本、结果数量、引用条数、引用摘录、事实陈述和 source JSON 都有硬上限；
未知字段、路径、密钥样式和敏感字段被 TS runtime validator 与 Python
Pydantic 双重拒绝。搜索结果的 `evidence.status` 永远是 `unverified`，
因此结果不能被下游当作已核实事实。

## URL 安全

V1 只接受明确的 `http`/`https` URL。拒绝凭据、fragment、`file:`、`data:`、
`javascript:`、localhost、回环/私有/链路本地/保留 IP、常见内网域名后缀、
路径 `.`/`..` 段和编码路径注入。query 会拒绝 `api_key`、token、secret、
password、authorization、cookie、signature 等键及 bearer/API key 样式值；
V1 请求不接受任意 header，因此不会持久化 Cookie 或 Authorization。

当前 deterministic fake 不访问 DNS 或公网。未来真实 HTTP transport 必须在每次
连接和重定向前解析并重新检查 IP，固定 timeout、响应大小和最大重定向次数，
并使用同一 URL policy；不能把只通过字符串检查当作完整 SSRF 防护。

## 存储、幂等与回溯

`0004_research_sources.sql` 是向前迁移，不修改历史 migration。它新增：

- `research_searches`：保存项目内搜索请求摘要、request digest 和完整有界结果，
  以 `(project_id, idempotency_key)` 与 `(project_id, request_id)` 唯一约束支持
  稳定 replay；
- `source_records`：保存 `sourceId`、受控 URL、标题、摘要、站点/作者、
  `fetchedAtMs`、`contentDigest`、`sourceDigest`、引用/事实回溯和 transport
  provenance。记录不可更新，所有 repository 查询都带 `project_id`。

`contentDigest` 是 V1 的 `summary-content-v1` 指纹，覆盖标题、摘要和引用；
`sourceDigest` 覆盖规范化 URL、来源文本、content digest、回溯信息和 fake
provenance，但不覆盖抓取时间，因此同一来源内容的 digest 稳定。`save_source`
会重新计算两个 digest，篡改会得到 `RESEARCH_SOURCE_INVALID`。

首次保存返回 `created`。同一项目同一幂等键、同一 digest 返回 `existing`；
不同幂等键提交同一 digest 返回 `duplicate`，都复用原 `sourceId`。同幂等键
提交不同内容返回 `RESEARCH_IDEMPOTENCY_CONFLICT`。不同项目即使 URL/digest
相同也分别创建记录。

每条事实都通过 `facts[].citationIds` 指向 `citations[]` 的 bounded quote 和
`title`/`summary` locator。保存结果同时返回 sourceId、URL、摘要、抓取时间和
sourceDigest；D05 可以据此建立 provenance，但仍必须保留“待核实/需用户确认”
状态。

## Transport 与错误

Python Core 使用可替换的 `ResearchTransport` seam。V1 只注册
`deterministic-fake-v1`，fixture 使用 `example.com` 示例 URL，明确不代表真实
抓取证据，也不访问外网。真实 provider、API key、header、网页全文下载和许可
判断不在本包。

稳定错误包括：

- `RESEARCH_INPUT_INVALID`、`RESEARCH_URL_INVALID`、`RESEARCH_SOURCE_INVALID`；
- `RESEARCH_IDEMPOTENCY_CONFLICT`、`RESEARCH_STORAGE_INVALID`；
- `RESEARCH_TRANSPORT_UNAVAILABLE`、`RESEARCH_TIMEOUT`、`RESEARCH_CANCELLED`。

网络失败不伪装为空结果；timeout/cancel 通过固定错误码返回，日志只记录方法、
项目范围和错误码，不记录 query 全文、URL query、摘要、凭据或本机路径。

## 限制与后续边界

E01 不下载授权素材，不判断“可商用”，不实现 E03 许可门禁，不为 E02 选择或
下载图片/视频，也不把网页摘要自动提升成脚本事实。E02 可以复用
`source_records` 和 `sourceDigest`，E03 可以在此之上增加许可字段与导出门禁；
两者都必须保留本 V1 的 project scope、不可变来源和回溯语义。
