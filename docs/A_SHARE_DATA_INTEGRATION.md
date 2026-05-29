# 股票数据能力集成说明

## 目标

将 `a-stock-data` 与 `global-stock-data` Skill 中适合当前系统的公开数据能力，按 StockTracker 的 TypeScript/Agent Skill 架构接入。当前阶段只接入可自动获取或无 API Key 的 HTTP 数据源，不引入 Python、mootdx TCP 运行时或 iwencai Key 依赖。

## A 股已接入数据源

### A 股财报分析增强

`stock.getFinancials` 在 A 股场景下会优先读取以下结构化来源，并作为 LangChain 财报分析子链的上下文：

- 东财个股基本面：行业、股本、市值、上市日期。
- 新浪财报三表：利润表、资产负债表、现金流量表。
- 同花顺一致预期 EPS：前向 EPS 参考。
- 东财研报：研报标题、机构、评级、EPS 预测和 PDF 链接。
- 巨潮公告：公告标题、类型、日期和详情链接。

如果这些结构化来源不足，才回退到现有公开搜索补充资料。用户手动上传财报文件时，仍优先使用上传文件内容。

### A 股信号 Skill

新增 `stock.getAshareSignals`，用于自由对话里回答 A 股资金面、筹码和事件驱动问题：

- 龙虎榜上榜记录、买入/卖出席位。
- 未来限售解禁。
- 融资融券明细。
- 大宗交易。
- 股东户数变化。
- 分红送转历史。
- 近 120 日主力/大单/中单/小单资金流。

该 Skill 只支持 A 股。港股、美股、ETF、基金和加密资产不使用该入口。

## 港美股已接入数据源

### 港美股财报分析增强

`stock.getFinancials` 在港股/美股场景下会优先读取以下结构化来源，并作为 LangChain 财报分析子链的上下文：

- 东财 datacenter 三表：资产负债表、利润表、现金流量表，中文科目名。
- 东财 GMAININDICATOR：营收、EPS、ROE、ROA、毛利率、净利率、资产负债率等关键指标。
- Yahoo quoteSummary：关键估值、盈利能力、成长性、目标价和推荐倾向。
- Yahoo 分析师预期：EPS 预测、评级趋势、升降级历史。
- Yahoo 机构持仓：机构/内部人持股比例、前十大机构。
- SEC EDGAR Filing：美股 10-K、10-Q、8-K 等 Filing 列表。
- SEC EDGAR companyfacts：美股 XBRL 结构化指标，如营收、净利润、EPS、资产、负债、经营现金流。

### 港美股信号 Skill

新增 `stock.getGlobalSignals`，用于自由对话里回答港股/美股扩展信号问题：

- 东财 push2his 日级资金流。
- Yahoo 期权链：到期日、calls、puts、隐含波动率、未平仓量。仅美股。
- SEC Filing：仅美股。
- Yahoo Finance 新闻。
- 东财全市场列表：可选读取港股/纳斯达克/纽交所/美股 ETF 排名。

该 Skill 只支持港股和美股。A 股资金面和事件信号使用 `stock.getAshareSignals`。

## 代码结构

- `lib/external/aShare/`
  - `eastmoney.ts`：东财数据中心、个股信息、研报、资金流。
  - `sina.ts`：新浪财报三表。
  - `cninfo.ts`：巨潮公告。
  - `ths.ts`：同花顺一致预期 EPS。
  - `types.ts`：A 股数据结构。
  - `utils.ts`：代码归一化、日期/数字解析。
- `lib/external/globalStock/`
  - `eastmoney.ts`：东财港美股搜索、三表、关键指标、资金流和市场列表。
  - `yahoo.ts`：Yahoo quoteSummary、期权链、新闻，以及 cookie/crumb 管理。
  - `sec.ts`：SEC ticker-CIK 映射、Filing、companyfacts。
  - `types.ts`：港美股数据结构。
  - `utils.ts`：Yahoo/东财/SEC 代码格式转换、日期/数字解析。
- `lib/agent/skills/stock.ts`
  - 扩展 `stock.getFinancials`。
  - 新增 `stock.getAshareSignals`。
  - 新增 `stock.getGlobalSignals`。
- `skills/builtin/stock-get-ashare-signals/`
  - Agent Skill manifest 和 handler。
- `skills/builtin/stock-get-global-signals/`
  - Agent Skill manifest 和 handler。

## 暂未接入

- `mootdx`：需要 Python/TCP 运行时，跨平台部署和错误处理成本较高。
- `iwencai`：需要 API Key 和 X-Claw 头，后续可做成可选配置。
- PDF 研报全文下载：当前保存 PDF 链接，不自动下载全文，避免大文件和版权边界问题。
- 港股期权：Yahoo 不覆盖港股期权，暂不接入。

## 验证

- `tests/a-share-data.test.ts` 覆盖 A 股代码归一化、同花顺 EPS HTML 解析、财报上下文聚合和信号数据映射。
- `tests/global-stock-data.test.ts` 覆盖港美股搜索、财报上下文聚合、Yahoo/SEC/东财信号映射。
- `tests/agent-stock-skills.test.ts` 覆盖 `stock.getAshareSignals` 的非 A 股拒绝逻辑。
- `tests/agent-stock-skills.test.ts` 覆盖 `stock.getGlobalSignals` 的非港美股拒绝逻辑。
- `tests/agent-skill-loader.test.ts` 覆盖新增 Skill manifest。
