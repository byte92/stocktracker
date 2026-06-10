# 行情获取说明

本文档说明 StockTracker 当前的报价、K 线、估值和外部数据源策略。

## 当前能力

- 多数据源报价聚合。
- 按市场选择 fallback 链路。
- 短期缓存，减少重复请求。
- 估值字段归一化，例如 `PE(TTM)`、`EPS(TTM)`、`PB`、`总市值`。
- K 线和技术指标数据通过统一外部接口入口获取。
- 加密资产报价和 K 线，优先 Binance，失败回退 Coinbase。
- 外部接口 smoke test，用于发现上游接口变化。

## 报价数据源

| 数据源 | 主要用途 | 是否需要 Key | 代码入口 |
| --- | --- | --- | --- |
| Tencent Finance | A 股、港股、基金、美股兜底报价和部分估值字段 | 否 | `lib/dataSources/TencentFinanceSource.ts` |
| Nasdaq | 美股报价 | 否 | `lib/dataSources/NasdaqSource.ts` |
| Yahoo Finance | 美股及部分市场报价兜底，quote 不可用时 fallback 到 chart | 否 | `lib/dataSources/YahooFinanceSource.ts` |
| Binance / Coinbase | 加密资产现货报价，优先 USDT，失败回退 USD | 否 | `lib/dataSources/CryptoSource.ts` |
| Alpha Vantage | 备用报价源 | 是 | `lib/dataSources/AlphaVantageSource.ts` |
| Manual | 手动兜底占位 | 否 | `lib/dataSources/ManualSource.ts` |

报价聚合入口：

- `lib/StockPriceService.ts`

内部 API Route：

- `app/api/stock/quote/route.ts`

## K 线、新闻和大盘数据

这些外部接口已经收敛到 `lib/external`：

| 类型 | 代码入口 |
| --- | --- |
| K 线 | `lib/external/kline.ts` |
| 新闻 | `lib/external/news.ts` |
| 大盘指数 | `lib/external/marketIndices.ts` |
| LLM Provider | `lib/external/llmProvider.ts` |

完整清单见 [数据接口清单](./DATA_API_INVENTORY.md)。

## Fallback 策略

美股报价优先链路：

```text
Nasdaq -> Tencent -> Yahoo Finance -> Alpha Vantage -> Manual
```

加密资产报价优先链路：

```text
CryptoSource(Binance -> Coinbase) -> Manual
```

其他市场默认链路：

```text
Tencent -> Nasdaq -> Yahoo Finance -> Alpha Vantage -> Manual
```

实际可用性还会受市场、标的、上游限制和 API Key 配置影响。`CryptoSource` 只响应 `CRYPTO` 市场，即使出现在内部 fallback 配置中，也不会为非加密市场返回报价。

Stooq 的公开 CSV 端点曾作为美股兜底，但当前返回 404 或浏览器验证页，不再进入默认 fallback 链。保留 `StooqSource` 仅用于后续评估或替换时参考。

## 缓存策略

`StockPriceService` 会按标的和市场缓存短期报价。不同数据源可以配置不同 TTL。缓存只用于减少重复请求，不用于长期历史行情存储。

## Alpha Vantage

Alpha Vantage 是备用源，需要配置 API Key：

```bash
ALPHA_VANTAGE_API_KEY=YOUR_KEY_HERE
```

兼容旧配置：

```bash
NEXT_PUBLIC_ALPHA_VANTAGE_API_KEY=YOUR_KEY_HERE
```

不推荐使用 `NEXT_PUBLIC_` 存放真实 Key，因为它会暴露到前端构建产物中。

## 外部接口测试

默认测试不请求真实外部网络：

```bash
pnpm test
```

检查外部接口是否仍可用：

```bash
pnpm test:external
```

该测试覆盖报价、K 线、大盘指数、新闻和汇率。Alpha Vantage 未配置 Key 时会自动跳过。

## 新增数据源建议

新增数据源时建议：

1. 在 `types/stockApi.ts` 扩展 provider 类型。
2. 在 `lib/dataSources` 新增数据源实现。
3. 在 `lib/StockPriceService.ts` 注册数据源和 fallback 顺序。
4. 在 `docs/DATA_API_INVENTORY.md` 补充接口说明。
5. 在 `tests/external-apis.test.ts` 补充 smoke test。
6. 如果影响用户配置，同步更新 `.env.example` 和 `docs/DEVELOPMENT.md`。
