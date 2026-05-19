"use client";

import { create } from "zustand";
import { DEFAULT_APP_CONFIG } from "@/config/defaults";
import { describeClientRequestError, readJsonResponse } from "@/lib/api/client";
import { nextApiUrls } from "@/lib/api/endpoints";
import { adoptDeviceIdFromLocalUserId, getDeviceId } from "@/lib/device-id";
import { generateId } from "@/lib/finance";
import type { AppConfig, ExportData, Market, Stock, Trade } from "@/types";

interface StockStore {
  stocks: Stock[];
  config: AppConfig;
  userId: string | null;

  init: () => Promise<void>;
  sync: () => Promise<void>;
  addStock: (data: {
    code: string;
    name: string;
    market: Market;
    note?: string;
  }) => Promise<Stock>;
  updateStock: (id: string, data: Partial<Pick<Stock, "code" | "name" | "note">>) => Promise<void>;
  deleteStock: (id: string) => Promise<void>;
  addTrade: (
    stockId: string,
    trade: Omit<Trade, "id" | "stockId" | "createdAt" | "updatedAt">,
  ) => Promise<void>;
  updateTrade: (stockId: string, tradeId: string, data: Partial<Trade>) => Promise<void>;
  deleteTrade: (stockId: string, tradeId: string) => Promise<void>;
  updateConfig: (config: Partial<AppConfig>) => Promise<void>;
  exportData: () => ExportData;
  importData: (data: ExportData) => void;
  clearAll: () => void;
}

type StoredPayload = {
  stocks: Stock[];
  config: AppConfig;
};

type RemoteStoredPayload = StoredPayload & {
  userId?: string;
  recovered?: boolean;
};

type LegacyAiConfig = Partial<AppConfig["aiConfig"]> & {
  promptTemplates?: unknown;
};

function normalizeAiConfig(aiConfig?: LegacyAiConfig): AppConfig["aiConfig"] {
  const { promptTemplates: _legacyPromptTemplates, ...rest } = aiConfig ?? {};
  return {
    ...DEFAULT_APP_CONFIG.aiConfig,
    ...rest,
  };
}

function mergeAppConfig(config?: Partial<AppConfig>): AppConfig {
  return {
    version: config?.version ?? DEFAULT_APP_CONFIG.version,
    defaultMarket: config?.defaultMarket ?? DEFAULT_APP_CONFIG.defaultMarket,
    feeConfigs: {
      ...DEFAULT_APP_CONFIG.feeConfigs,
      ...(config?.feeConfigs ?? {}),
    },
    aiConfig: normalizeAiConfig(config?.aiConfig as LegacyAiConfig | undefined),
    currency: {
      ...DEFAULT_APP_CONFIG.currency,
      ...(config?.currency ?? {}),
    },
    portfolio: {
      ...DEFAULT_APP_CONFIG.portfolio,
      ...(config?.portfolio ?? {}),
    },
  };
}

const LOCAL_KEY = "stock-tracker-storage";
const LOCAL_SQLITE_USER_PREFIX = "local:";
const STORAGE_UNAVAILABLE_MESSAGE = "本地数据服务暂时不可用，请稍后重试。";

function loadFromLocalStorage(): StoredPayload {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return { stocks: [], config: DEFAULT_APP_CONFIG };
    const parsed = JSON.parse(raw) as Partial<StoredPayload>;
    return {
      stocks: parsed.stocks ?? [],
      config: mergeAppConfig(parsed.config),
    };
  } catch (error) {
    console.error("Failed to load local data:", error);
    return { stocks: [], config: DEFAULT_APP_CONFIG };
  }
}

function saveToLocalStorage(stocks: Stock[], config: AppConfig) {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify({ stocks, config }));
  } catch (error) {
    console.error("Failed to save local data:", error);
  }
}

function createLocalSqliteUserId() {
  return `${LOCAL_SQLITE_USER_PREFIX}${getDeviceId()}`;
}

function hasStoredData(payload: StoredPayload) {
  return (
    payload.stocks.length > 0 ||
    JSON.stringify(payload.config) !== JSON.stringify(DEFAULT_APP_CONFIG)
  );
}

function cleanDividendTaxNote(note?: string) {
  if (!note) return note;
  return note
    .replace(/[，,]\s*税率\s*\d+(?:\.\d+)?\s*%/g, "")
    .replace(/[，,]\s*tax\s*\d+(?:\.\d+)?\s*%/gi, "")
    .replace(/\s*税率\s*\d+(?:\.\d+)?\s*%/g, "")
    .replace(/\s*tax\s*\d+(?:\.\d+)?\s*%/gi, "")
    .trim();
}

function normalizeTradeNotes(stocks: Stock[]) {
  return stocks.map((stock) => ({
    ...stock,
    trades: stock.trades.map((trade) => (
      trade.type === "DIVIDEND"
        ? { ...trade, note: cleanDividendTaxNote(trade.note) }
        : trade
    )),
  }));
}

async function fetchRemote(userId: string): Promise<RemoteStoredPayload> {
  const res = await fetch(nextApiUrls.storage({ userId }), {
    method: "GET",
    cache: "no-store",
  });
  const payload = await readJsonResponse<RemoteStoredPayload>(res, {
    fallbackMessage: "读取本地数据失败，请稍后重试。",
    unavailableMessage: STORAGE_UNAVAILABLE_MESSAGE,
  });
  return {
    stocks: payload.stocks ?? [],
    config: mergeAppConfig(payload.config),
    userId: (payload as RemoteStoredPayload).userId,
    recovered: (payload as RemoteStoredPayload).recovered,
  };
}

async function persistRemote(userId: string, stocks: Stock[], config: AppConfig) {
  const res = await fetch(nextApiUrls.storage(), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, stocks, config }),
  });
  await readJsonResponse<{ ok: true }>(res, {
    fallbackMessage: "保存本地数据失败，请稍后重试。",
    unavailableMessage: STORAGE_UNAVAILABLE_MESSAGE,
  });
}

async function clearRemoteAiChat(userId: string) {
  const res = await fetch(nextApiUrls.ai.chatSessions(), {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, all: true }),
  });
  await readJsonResponse<{ ok: true }>(res, {
    fallbackMessage: "清理 AI 对话失败，请稍后重试。",
    unavailableMessage: "AI 对话服务暂时不可用，请稍后重试。",
  });
}

function sortTrades(stocks: Stock[]) {
  return normalizeTradeNotes(stocks).map((stock) => ({
    ...stock,
    trades: [...stock.trades].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()),
  }));
}

export const useStockStore = create<StockStore>()((set, get) => ({
  stocks: [],
  config: DEFAULT_APP_CONFIG,
  userId: null,

  init: async () => {
    try {
      const local = loadFromLocalStorage();
      const requestedUserId = createLocalSqliteUserId();
      const sqlitePayload = await fetchRemote(requestedUserId);
      const userId = sqlitePayload.userId ?? requestedUserId;
      if (sqlitePayload.recovered) {
        adoptDeviceIdFromLocalUserId(userId);
      }
      const nextPayload = hasStoredData(sqlitePayload) ? sqlitePayload : local;
      const normalized = sortTrades(nextPayload.stocks);

      if (!hasStoredData(sqlitePayload) && hasStoredData(local)) {
        await persistRemote(userId, normalized, nextPayload.config);
      } else if (JSON.stringify(normalized) !== JSON.stringify(nextPayload.stocks)) {
        await persistRemote(userId, normalized, nextPayload.config);
      }

      saveToLocalStorage(normalized, nextPayload.config);
      set({
        userId,
        stocks: normalized,
        config: nextPayload.config,
      });
    } catch (error) {
      console.error("Failed to initialize store:", describeClientRequestError(error, STORAGE_UNAVAILABLE_MESSAGE), error);
      const local = loadFromLocalStorage();
      const userId = createLocalSqliteUserId();
      set({
        userId,
        stocks: local.stocks,
        config: local.config,
      });
    }
  },

  sync: async () => {
    const userId = get().userId;
    if (!userId) return;
    try {
      const remote = await fetchRemote(userId);
      const normalized = sortTrades(remote.stocks);
      saveToLocalStorage(normalized, remote.config);
      set({
        stocks: normalized,
        config: remote.config,
      });
    } catch (error) {
      console.error("Sync failed:", describeClientRequestError(error, STORAGE_UNAVAILABLE_MESSAGE), error);
    }
  },

  addStock: async (data) => {
    const now = new Date().toISOString();
    const stock: Stock = {
      id: generateId(),
      ...data,
      trades: [],
      createdAt: now,
      updatedAt: now,
    };

    const nextStocks = [...get().stocks, stock];
    const nextConfig = get().config;
    set({ stocks: nextStocks });
    saveToLocalStorage(nextStocks, nextConfig);

    const userId = get().userId;
    if (userId) {
      try {
        await persistRemote(userId, nextStocks, nextConfig);
      } catch (error) {
        console.error("Persist stock failed:", error);
      }
    }
    return stock;
  },

  updateStock: async (id, data) => {
    const now = new Date().toISOString();
    const nextStocks = get().stocks.map((s) => (s.id === id ? { ...s, ...data, updatedAt: now } : s));
    const nextConfig = get().config;
    set({ stocks: nextStocks });
    saveToLocalStorage(nextStocks, nextConfig);

    const userId = get().userId;
    if (userId) {
      try {
        await persistRemote(userId, nextStocks, nextConfig);
      } catch (error) {
        console.error("Update stock failed:", error);
      }
    }
  },

  deleteStock: async (id) => {
    const nextStocks = get().stocks.filter((s) => s.id !== id);
    const nextConfig = get().config;
    set({ stocks: nextStocks });
    saveToLocalStorage(nextStocks, nextConfig);

    const userId = get().userId;
    if (userId) {
      try {
        await persistRemote(userId, nextStocks, nextConfig);
      } catch (error) {
        console.error("Delete stock failed:", error);
      }
    }
  },

  addTrade: async (stockId, tradeData) => {
    const now = new Date().toISOString();
    const trade: Trade = {
      id: generateId(),
      stockId,
      ...tradeData,
      createdAt: now,
      updatedAt: now,
    };

    const nextStocks = sortTrades(
      get().stocks.map((s) => (s.id === stockId ? { ...s, updatedAt: now, trades: [...s.trades, trade] } : s)),
    );
    const nextConfig = get().config;
    set({ stocks: nextStocks });
    saveToLocalStorage(nextStocks, nextConfig);

    const userId = get().userId;
    if (userId) {
      try {
        await persistRemote(userId, nextStocks, nextConfig);
      } catch (error) {
        console.error("Add trade failed:", error);
      }
    }
  },

  updateTrade: async (stockId, tradeId, data) => {
    const now = new Date().toISOString();
    const nextStocks = sortTrades(
      get().stocks.map((s) =>
        s.id === stockId
          ? {
              ...s,
              updatedAt: now,
              trades: s.trades.map((t) => (t.id === tradeId ? { ...t, ...data, updatedAt: now } : t)),
            }
          : s,
      ),
    );
    const nextConfig = get().config;
    set({ stocks: nextStocks });
    saveToLocalStorage(nextStocks, nextConfig);

    const userId = get().userId;
    if (userId) {
      try {
        await persistRemote(userId, nextStocks, nextConfig);
      } catch (error) {
        console.error("Update trade failed:", error);
      }
    }
  },

  deleteTrade: async (stockId, tradeId) => {
    const nextStocks = get().stocks.map((s) =>
      s.id === stockId ? { ...s, trades: s.trades.filter((t) => t.id !== tradeId) } : s,
    );
    const nextConfig = get().config;
    set({ stocks: nextStocks });
    saveToLocalStorage(nextStocks, nextConfig);

    const userId = get().userId;
    if (userId) {
      try {
        await persistRemote(userId, nextStocks, nextConfig);
      } catch (error) {
        console.error("Delete trade failed:", error);
      }
    }
  },

  updateConfig: async (configPatch) => {
    const nextConfig = mergeAppConfig({
      ...get().config,
      ...configPatch,
      feeConfigs: {
        ...get().config.feeConfigs,
        ...(configPatch.feeConfigs ?? {}),
      },
      aiConfig: {
        ...get().config.aiConfig,
        ...(configPatch.aiConfig ?? {}),
      },
      currency: {
        ...get().config.currency,
        ...(configPatch.currency ?? {}),
      },
      portfolio: {
        ...get().config.portfolio,
        ...(configPatch.portfolio ?? {}),
      },
    });
    const nextStocks = get().stocks;
    set({ config: nextConfig });
    saveToLocalStorage(nextStocks, nextConfig);

    const userId = get().userId;
    if (userId) {
      try {
        await persistRemote(userId, nextStocks, nextConfig);
      } catch (error) {
        console.error("Update config failed:", error);
      }
    }
  },

  exportData: () => {
    const { stocks, config } = get();
    const exportConfig = {
      ...config,
      aiConfig: {
        ...config.aiConfig,
        apiKey: "",
      },
    };
    return {
      meta: {
        version: config.version,
        exportedAt: new Date().toISOString(),
        appName: "StockTracker",
      },
      config: exportConfig,
      stocks,
    };
  },

  importData: (data) => {
    const next = {
      stocks: sortTrades(data.stocks),
      config: mergeAppConfig(data.config),
    };
    set(next);
    saveToLocalStorage(next.stocks, next.config);

    const userId = get().userId;
    if (userId) {
      void persistRemote(userId, next.stocks, next.config).catch((error) => {
        console.error("Import data failed:", error);
      });
    }
  },

  clearAll: () => {
    const next = { stocks: [], config: DEFAULT_APP_CONFIG };
    set(next);
    saveToLocalStorage(next.stocks, next.config);

    const userId = get().userId;
    if (userId) {
      void persistRemote(userId, next.stocks, next.config).catch((error) => {
        console.error("Clear data failed:", error);
      });
      void clearRemoteAiChat(userId).catch((error) => {
        console.error("Clear AI chat failed:", error);
      });
    }
  },
}));
