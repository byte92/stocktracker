**_CRITICAL_**

This repository targets Node.js 20.9+ on macOS/Linux/Windows. Always install dependencies via `pnpm install` (or `pnpm install --frozen-lockfile`) before running scripts so lockfile stays in sync.

StockTracker is a Next.js/TypeScript front-end for tracking stock trades and fees; read `README.md` for product goals and directory context.

- Next.js App Router lives in `app/`. Components under `components/` share the global design tokens defined in `app/globals.css`.
- Business logic sits in `lib/` (finance.ts, stock data sources) and is consumed by the Zustand store in `store/useStockStore.ts`.
- Prefer updating `config/` defaults when adding new markets or fee rules. Keep `types/` in sync with any data model changes.

When extending or debugging, run the local dev server with `pnpm dev` and verify your change in the browser at http://localhost:3218.

For tests use `pnpm test` and for building use `pnpm build` to catch TypeScript/Next errors early.

Avoid editing anything under `node_modules/`. If you need new dependencies, add them with `pnpm install <pkg> --save` (respecting the lockfile) and mention the reason in your notes.

If you touch financial calculations, double-check FIFO, fee, and quote logic in `lib/finance.ts` plus related hooks and store behavior; these are sensitive and unit tests are not currently present, so manual review is required.
