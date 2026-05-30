# StockTracker

[![English](https://img.shields.io/badge/README-English-blue)](./README_en.md)
[![中文](https://img.shields.io/badge/README-%E4%B8%AD%E6%96%87-lightgrey)](./README.md)

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
![Node.js](https://img.shields.io/badge/node-18%2B-339933?logo=node.js&logoColor=white)
![pnpm](https://img.shields.io/badge/pnpm-10.x-F69220?logo=pnpm&logoColor=white)
![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-ready-2496ED?logo=docker&logoColor=white)

StockTracker is a local-first personal investment tracker, portfolio accounting tool, and AI research workspace.

It helps you record trades, calculate real cost basis, track market data and returns, and use an AI Agent to analyze your actual holdings, trades, and public market context. Your data is stored locally in SQLite by default, with no account system and no cloud upload by default.

[Quick Start](#quick-start) · [Docker](#docker) · [Core Features](#core-features) · [AI Agent](#ai-agent) · [Documentation](#documentation) · [Disclaimer](#disclaimer)

## Screenshots and Demo

> Screenshots are generated with sanitized demo data and do not include real holdings or trade records.

| Portfolio Overview | Holdings |
| --- | --- |
| ![Portfolio overview](./docs/assets/screenshots/readme-overview.png) | ![Holdings](./docs/assets/screenshots/readme-portfolio.png) |

| Stock Detail | AI Chat |
| --- | --- |
| ![Stock detail](./docs/assets/screenshots/readme-stock-detail.png) | ![AI chat](./docs/assets/screenshots/readme-ai-chat.png) |

## Why StockTracker 💡

Most investment tools show prices, but do not answer the specific questions that matter for personal portfolio accounting: what is the real cost basis, and how do fees and dividends factor in.

StockTracker is built around getting those numbers right: FIFO-based sell P/L with broker-style diluted cost basis including fees; an AI Agent that reads your actual holdings, lots, and trade history instead of giving generic commentary. Data is stored locally in SQLite by default, with no account required and no cloud upload.

## Who It Is For 🎯

StockTracker is a good fit if you:

- Track your own stocks, ETFs, funds, or crypto assets.
- Care about FIFO, fees, dividends, income, and real cost basis.
- Want your data to stay local by default, with explicit backup and migration.
- Want AI to work with your holdings and trade review instead of generic chat.
- Are comfortable self-hosting and accepting occasional third-party data-source instability.

StockTracker is not designed for:

- High-frequency trading, auto-ordering, or broker account syncing.
- Multi-user cloud collaboration, real-time cross-device sync, or team back offices.
- Production trading terminals with strict market-data compliance requirements.
- Guaranteed investment advice, return promises, or automatic buy/sell instructions.

## Core Features ✨

### Portfolio Accounting 📊

- Local SQLite persistence, with no cloud account required by default.
- Unified record model for A-shares including ETFs, HK stocks, US stocks, funds, and crypto assets.
- Buy, sell, dividend, and crypto income records.
- Fixed FIFO-based sell P/L details, with broker-style diluted cost basis for current holding cost, unrealized P/L, and total P/L.
- Market-specific automatic fee calculation with user-configurable rates.

### Market Data and Charts 📈

- Aggregates stock quotes from Tencent Finance, Nasdaq, Yahoo Finance, Stooq, Alpha Vantage, and more.
- Crypto quotes and candles prefer Binance and fall back to Coinbase.
- K-line charts, technical indicators, valuation fields, news, and market overview.
- Built-in exchange-rate service for unified multi-currency portfolio conversion.
- Multi-source fallback with Manual input mode as the final safety net.

### AI Research Workflow 🤖

- Built-in AI chat, portfolio analysis, stock analysis, and market analysis.
- AI Agent Runtime calls Skills on demand instead of stuffing all holdings into every prompt.
- Supports non-holding assets by resolving name, symbol, and market, then fetching external quote data.
- Public web search and controlled web fetch for news, announcements, earnings, and market events.
- Controlled AI Agent Trace view for inspecting intent recognition and Skill call chains.

### Self-hosting and Engineering 🧰

- pnpm-only dependency workflow to keep the lockfile deterministic.
- Docker / Docker Compose support for local self-hosting.
- Chinese / English UI switching, with preference stored locally in the browser.
- OpenAI-compatible and Anthropic-compatible model providers.
- Structured server logs and external API smoke tests for diagnosing upstream changes.

## Quick Start 🚀

Requirements:

- Node.js 18+
- pnpm
- macOS / Linux / Windows

```bash
git clone https://github.com/byte92/stocktracker.git
cd stocktracker
pnpm install
pnpm dev
```

After starting, visit:

- [http://localhost:3218](http://localhost:3218)

`pnpm dev` uses `3218` by default; if that port is occupied, it automatically finds the next available port and prints the actual URL. After starting, configure an AI model to unlock the core chat, portfolio analysis, stock analysis, and market analysis experience.

For development, environment variables, database, and testing details, see the [Development Guide](./docs/DEVELOPMENT.md).

## AI Model Configuration 🔑

StockTracker's core experience depends on AI chat and analysis. Put model connection settings in `.env.local`:

```bash
cp .env.example .env.local
```

Common variables:

```bash
AI_PROVIDER=openai-compatible
AI_BASE_URL=https://api.openai.com/v1
AI_MODEL=gpt-4.1-mini
AI_API_KEY=sk-...
```

If `.env.local` contains a complete AI configuration, the server uses it first. The settings page connection fields remain local fallbacks. Temperature, Max Context Tokens, news enhancement, and AI analysis language are still controlled from the settings page.

## Docker 🐳

If you just want to run StockTracker as a local service, use Docker Compose:

```bash
git clone https://github.com/byte92/stocktracker.git
cd stocktracker/docker
docker compose up -d --build
```

After starting, visit:

- [http://localhost:3218](http://localhost:3218)

For custom host ports, copy `docker/.env.example` to `docker/.env` and set `HOST_PORT`. For AI features, copy the root `.env.example` to `.env.local` and fill in your model configuration; Docker Compose optionally injects `.env.local` into the container. Without `docker/.env`, the host port defaults to `3218`.

SQLite data is stored in a Docker volume by default, so it persists across container restarts. For more details, see the [Docker Deployment Guide](./docker/README.md).

## AI Agent 🤖

StockTracker's AI is not a generic chatbot. It is an investment research Agent built around your personal holdings and stock data.

```text
User question
  -> Planner identifies intent, market, and required data
  -> security.resolve resolves names, symbols, and candidate assets
  -> Skill Registry selects local holdings, quotes, technical indicators, web search, and other capabilities
  -> Executor reads data on demand
  -> Context Composer assembles the minimum necessary context
  -> LLM streams the response
```

When users ask about stock news, announcements, bullish/bearish events, or today's A-share policies and market events, the Agent can call public web search on demand. Search results enter the answer context with title, URL, summary, and searched time.

## Tech Stack 🧱

- Next.js App Router + React + TypeScript
- Zustand
- SQLite + better-sqlite3
- Tailwind CSS
- lightweight-charts / Recharts
- Playwright
- pnpm
- Docker / Docker Compose

## Architecture 🧭

```mermaid
flowchart TB
  User["User / Browser"] --> App["Next.js App Router"]
  App --> Store["Zustand State Layer"]
  App --> Api["API Routes"]

  Store --> Api
  Api --> SQLite["Local SQLite Database"]
  Api --> Finance["P/L / Fee / FIFO Calculation"]
  Api --> DataSources["Market Data, K-line, News, FX Sources"]

  App --> AgentUI["AI Chat & Analysis UI"]
  AgentUI --> Agent["AI Agent Runtime"]
  Agent --> Planner["Planner Intent Recognition"]
  Agent --> Skills["Skill Registry"]
  Skills --> SQLite
  Skills --> DataSources
  Agent --> LLM["OpenAI / Anthropic Compatible Model Service"]

  Docker["Docker / Docker Compose"] --> App
  Docker --> SQLite
```

## Documentation 📚

- [Development Guide](./docs/DEVELOPMENT.md)
- [Docker Deployment Guide](./docker/README.md)
- [Project Structure](./docs/PROJECT_STRUCTURE.md)
- [Agent Architecture](./docs/AGENT_ARCHITECTURE.md)
- [Price Fetching](./docs/PRICE_FETCHING.md)

## Contributing 🤝

Issues, documentation improvements, test coverage, UI enhancements, data-source fixes, Skill extensions, and Agent Runtime improvements are all welcome.

Please read [CONTRIBUTING.md](./CONTRIBUTING.md) before submitting a PR.

## Disclaimer ⚠️

StockTracker provides trade recording, data organization, and analysis assistance tools. It does not constitute investment advice. Market data, valuations, news, and AI output may contain delays, omissions, or errors. Please make independent risk judgments and take responsibility for your own investment decisions.

## License

[MIT](./LICENSE)
