import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { DEFAULT_APP_CONFIG } from "@/config/defaults";
import { logger } from "@/lib/observability/logger";
import type { AiAgentRun, AiAnalysisHistoryRecord, AiAnalysisResult, AiChatMessage, AiChatSession, AiChatRole, AppConfig, Market, Stock } from "@/types";

export type StoredPayload = {
  stocks: Stock[];
  config: AppConfig;
};

export type ResolvedStoredPayload = StoredPayload & {
  userId: string;
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

function normalizePayload(payload: Partial<StoredPayload> | null | undefined): StoredPayload {
  return {
    stocks: payload?.stocks ?? [],
    config: {
      version: payload?.config?.version ?? DEFAULT_APP_CONFIG.version,
      defaultMarket: payload?.config?.defaultMarket ?? DEFAULT_APP_CONFIG.defaultMarket,
      feeConfigs: {
        ...DEFAULT_APP_CONFIG.feeConfigs,
        ...(payload?.config?.feeConfigs ?? {}),
      },
      aiConfig: normalizeAiConfig(payload?.config?.aiConfig as LegacyAiConfig | undefined),
      currency: {
        ...DEFAULT_APP_CONFIG.currency,
        ...(payload?.config?.currency ?? {}),
      },
    },
  };
}

function ensureDbDir(dbPath: string) {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function initSchema(db: Database.Database) {
  db.exec(`
  CREATE TABLE IF NOT EXISTS portfolios (
    user_id TEXT PRIMARY KEY,
    payload TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS ai_analysis_history (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    analysis_type TEXT NOT NULL,
    stock_id TEXT,
    stock_code TEXT,
    stock_name TEXT,
    market TEXT,
    confidence TEXT NOT NULL,
    tags_json TEXT NOT NULL,
    result_json TEXT NOT NULL,
    generated_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS ai_chat_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    title TEXT NOT NULL,
    scope TEXT NOT NULL,
    context_json TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS ai_chat_messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    context_snapshot_json TEXT,
    token_estimate INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    FOREIGN KEY(session_id) REFERENCES ai_chat_sessions(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_ai_chat_sessions_user_updated
    ON ai_chat_sessions(user_id, updated_at DESC);

  CREATE INDEX IF NOT EXISTS idx_ai_chat_messages_session_created
    ON ai_chat_messages(session_id, created_at ASC);

  CREATE TABLE IF NOT EXISTS ai_agent_runs (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    message_id TEXT,
    intent TEXT NOT NULL,
    response_mode TEXT NOT NULL,
    plan_json TEXT NOT NULL,
    skill_calls_json TEXT NOT NULL,
    skill_results_json TEXT NOT NULL,
    context_stats_json TEXT NOT NULL,
    error TEXT,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_ai_agent_runs_session_created
    ON ai_agent_runs(session_id, created_at DESC);
  `);
}

type SaveAiAnalysisInput = Omit<AiAnalysisHistoryRecord, "createdAt">;

type ListAiAnalysisFilters = {
  type?: string;
  confidence?: string;
  dateFrom?: string;
  dateTo?: string;
  stockId?: string;
  stockCode?: string;
  market?: string;
  limit?: number;
};

type SaveAiChatSessionInput = {
  id: string;
  userId: string;
  title: string;
  scope?: string;
};

type SaveAiChatMessageInput = {
  id: string;
  sessionId: string;
  userId: string;
  role: AiChatRole;
  content: string;
  contextSnapshot?: Record<string, unknown> | null;
  tokenEstimate?: number;
};

type SaveAiAgentRunInput = {
  id: string;
  sessionId: string;
  userId: string;
  messageId?: string | null;
  intent: string;
  responseMode: string;
  plan: Record<string, unknown>;
  skillCalls: unknown[];
  skillResults: unknown[];
  contextStats: Record<string, unknown>;
  error?: string | null;
};

function parseAnalysisRow(row: Record<string, unknown>): AiAnalysisHistoryRecord {
  const rawResult = JSON.parse(String(row.result_json)) as Partial<AiAnalysisResult>
  const normalizedResult: AiAnalysisResult = {
    generatedAt: rawResult.generatedAt ?? String(row.generated_at),
    cached: rawResult.cached ?? false,
    analysisStrength: rawResult.analysisStrength ?? 'high',
    summary: rawResult.summary ?? '暂无分析总结',
    stance: rawResult.stance ?? '中性偏观察',
    facts: rawResult.facts ?? rawResult.evidence ?? [],
    inferences: rawResult.inferences ?? (rawResult.summary ? [rawResult.summary] : []),
    actionPlan: rawResult.actionPlan ?? rawResult.actionableObservations ?? [],
    invalidationSignals: rawResult.invalidationSignals ?? rawResult.risks ?? [],
    timeHorizons: rawResult.timeHorizons ?? [],
    probabilityAssessment: rawResult.probabilityAssessment ?? [],
    technicalSignals: rawResult.technicalSignals ?? [],
    newsDrivers: rawResult.newsDrivers ?? [],
    keyLevels: rawResult.keyLevels ?? [],
    positionAdvice: rawResult.positionAdvice,
    portfolioRiskNotes: rawResult.portfolioRiskNotes,
    actionableObservations: rawResult.actionableObservations ?? [],
    risks: rawResult.risks ?? [],
    confidence: rawResult.confidence ?? 'medium',
    disclaimer: rawResult.disclaimer ?? '以上内容仅供参考，不构成投资建议。',
    evidence: rawResult.evidence ?? [],
  }

  return {
    id: String(row.id),
    userId: String(row.user_id),
    type: String(row.analysis_type) as AiAnalysisHistoryRecord["type"],
    stockId: row.stock_id ? String(row.stock_id) : null,
    stockCode: row.stock_code ? String(row.stock_code) : null,
    stockName: row.stock_name ? String(row.stock_name) : null,
    market: row.market ? (String(row.market) as Market) : null,
    confidence: String(row.confidence) as AiAnalysisHistoryRecord["confidence"],
    tags: JSON.parse(String(row.tags_json)) as string[],
    result: normalizedResult,
    generatedAt: String(row.generated_at),
    createdAt: String(row.created_at),
  };
}

function parseChatSessionRow(row: Record<string, unknown>): AiChatSession {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    title: String(row.title),
    scope: String(row.scope),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    messageCount: Number(row.message_count ?? 0),
    latestMessageAt: row.latest_message_at ? String(row.latest_message_at) : null,
  };
}

function parseChatMessageRow(row: Record<string, unknown>): AiChatMessage {
  const contextRaw = row.context_snapshot_json ? String(row.context_snapshot_json) : '';
  let contextSnapshot: Record<string, unknown> | null = null;
  if (contextRaw) {
    try {
      contextSnapshot = JSON.parse(contextRaw) as Record<string, unknown>;
    } catch {
      contextSnapshot = null;
    }
  }

  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    userId: String(row.user_id),
    role: String(row.role) as AiChatRole,
    content: String(row.content),
    contextSnapshot,
    tokenEstimate: Number(row.token_estimate ?? 0),
    createdAt: String(row.created_at),
  };
}

function safeJsonParse<T>(raw: unknown, fallback: T): T {
  try {
    return JSON.parse(String(raw)) as T;
  } catch {
    return fallback;
  }
}

function parseAiAgentRunRow(row: Record<string, unknown>): AiAgentRun {
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    userId: String(row.user_id),
    messageId: row.message_id ? String(row.message_id) : null,
    intent: String(row.intent),
    responseMode: String(row.response_mode),
    plan: safeJsonParse<Record<string, unknown>>(row.plan_json, {}),
    skillCalls: safeJsonParse<unknown[]>(row.skill_calls_json, []),
    skillResults: safeJsonParse<unknown[]>(row.skill_results_json, []),
    contextStats: safeJsonParse<Record<string, unknown>>(row.context_stats_json, {}),
    error: row.error ? String(row.error) : null,
    createdAt: String(row.created_at),
  };
}

export function resolveFinanceDbPath() {
  return process.env.FINANCE_SQLITE_PATH || path.join(process.cwd(), "data", "finance.sqlite");
}

export function createPortfolioStore(dbPath = resolveFinanceDbPath()) {
  ensureDbDir(dbPath);
  const db = new Database(dbPath);
  initSchema(db);

  // V2 迁移：为已有的 ai_chat_sessions 表补充 context_json 列
  try { db.exec('ALTER TABLE ai_chat_sessions ADD COLUMN context_json TEXT'); } catch { /* 列已存在 */ }

  function getPortfolioByUserId(userId: string): StoredPayload {
    const row = db
      .prepare("SELECT payload FROM portfolios WHERE user_id = ?")
      .get(userId) as { payload: string } | undefined;

    if (!row) {
      return { stocks: [], config: DEFAULT_APP_CONFIG };
    }

    try {
      const parsed = JSON.parse(row.payload) as Partial<StoredPayload>;
      return normalizePayload(parsed);
    } catch (error) {
      logger.error("sqlite.portfolio.parse.failed", { error, userId });
      return { stocks: [], config: DEFAULT_APP_CONFIG };
    }
  }

  function getLatestNonEmptyLocalPortfolio(): ResolvedStoredPayload | null {
    const row = db
      .prepare(
        `
        SELECT user_id, payload
        FROM portfolios
        WHERE user_id LIKE 'local:%'
          AND json_array_length(json_extract(payload, '$.stocks')) > 0
        ORDER BY updated_at DESC
        LIMIT 1
        `,
      )
      .get() as { user_id: string; payload: string } | undefined;

    if (!row) return null;

    try {
      const parsed = JSON.parse(row.payload) as Partial<StoredPayload>;
      return {
        ...normalizePayload(parsed),
        userId: row.user_id,
        recovered: true,
      };
    } catch (error) {
      logger.error("sqlite.portfolio.fallbackParse.failed", { error, userId: row.user_id });
      return null;
    }
  }

  function savePortfolioByUserId(userId: string, payload: StoredPayload) {
    const now = new Date().toISOString();
    const serialized = JSON.stringify(payload);

    db.prepare(
      `
      INSERT INTO portfolios (user_id, payload, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        payload = excluded.payload,
        updated_at = excluded.updated_at
      `,
    ).run(userId, serialized, now);
  }

  function rawInsert(userId: string, payload: string, updatedAt = new Date().toISOString()) {
    db.prepare(
      `
      INSERT INTO portfolios (user_id, payload, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        payload = excluded.payload,
        updated_at = excluded.updated_at
      `,
    ).run(userId, payload, updatedAt);
  }

  function close() {
    db.close();
  }

  function saveAiAnalysis(record: SaveAiAnalysisInput) {
    const createdAt = new Date().toISOString();
    db.prepare(
      `
      INSERT INTO ai_analysis_history (
        id, user_id, analysis_type, stock_id, stock_code, stock_name, market,
        confidence, tags_json, result_json, generated_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    ).run(
      record.id,
      record.userId,
      record.type,
      record.stockId ?? null,
      record.stockCode ?? null,
      record.stockName ?? null,
      record.market ?? null,
      record.confidence,
      JSON.stringify(record.tags),
      JSON.stringify(record.result),
      record.generatedAt,
      createdAt,
    );
  }

  function listAiAnalysisByUserId(userId: string, filters: ListAiAnalysisFilters = {}) {
    const clauses = ["user_id = ?"];
    const params: Array<string> = [userId];

    if (filters.type) {
      clauses.push("analysis_type = ?");
      params.push(filters.type);
    }
    if (filters.confidence) {
      clauses.push("confidence = ?");
      params.push(filters.confidence);
    }
    if (filters.dateFrom) {
      clauses.push("date(generated_at) >= date(?)");
      params.push(filters.dateFrom);
    }
    if (filters.dateTo) {
      clauses.push("date(generated_at) <= date(?)");
      params.push(filters.dateTo);
    }
    if (filters.stockId) {
      clauses.push("stock_id = ?");
      params.push(filters.stockId);
    }
    if (filters.stockCode) {
      clauses.push("stock_code = ?");
      params.push(filters.stockCode);
    }
    if (filters.market) {
      clauses.push("market = ?");
      params.push(filters.market);
    }

    const limit = filters.limit && Number.isFinite(filters.limit)
      ? Math.max(1, Math.floor(filters.limit))
      : null;
    const rows = db.prepare(
      `
      SELECT *
      FROM ai_analysis_history
      WHERE ${clauses.join(" AND ")}
      ORDER BY generated_at DESC
      ${limit ? "LIMIT ?" : ""}
      `,
    ).all(...(limit ? [...params, String(limit)] : params)) as Array<Record<string, unknown>>;

    return rows.map(parseAnalysisRow);
  }

  function deleteAiAnalysisById(userId: string, id: string) {
    const result = db.prepare(
      `
      DELETE FROM ai_analysis_history
      WHERE user_id = ? AND id = ?
      `,
    ).run(userId, id);

    return result.changes > 0;
  }

  function saveAiChatSession(input: SaveAiChatSessionInput) {
    const now = new Date().toISOString();
    db.prepare(
      `
      INSERT INTO ai_chat_sessions (id, user_id, title, scope, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        scope = excluded.scope,
        updated_at = excluded.updated_at
      `,
    ).run(input.id, input.userId, input.title, input.scope ?? 'portfolio', now, now);
  }

  function updateAiChatSessionTitle(userId: string, sessionId: string, title: string) {
    db.prepare(
      `
      UPDATE ai_chat_sessions
      SET title = ?, updated_at = ?
      WHERE user_id = ? AND id = ?
      `,
    ).run(title, new Date().toISOString(), userId, sessionId);
  }

  function setSessionContext(userId: string, sessionId: string, context: Record<string, unknown> | null) {
    if (context) {
      const json = JSON.stringify(context)
      db.prepare('UPDATE ai_chat_sessions SET context_json = ?, updated_at = ? WHERE user_id = ? AND id = ?')
        .run(json, new Date().toISOString(), userId, sessionId)
    } else {
      db.prepare('UPDATE ai_chat_sessions SET context_json = NULL, updated_at = ? WHERE user_id = ? AND id = ?')
        .run(new Date().toISOString(), userId, sessionId)
    }
  }

  function getSessionContext(userId: string, sessionId: string): Record<string, unknown> | null {
    const row = db.prepare('SELECT context_json FROM ai_chat_sessions WHERE user_id = ? AND id = ?')
      .get(userId, sessionId) as { context_json: string | null } | undefined
    if (!row?.context_json) return null
    try { return JSON.parse(row.context_json) } catch { return null }
  }

  function touchAiChatSession(userId: string, sessionId: string) {
    db.prepare(
      `
      UPDATE ai_chat_sessions
      SET updated_at = ?
      WHERE user_id = ? AND id = ?
      `,
    ).run(new Date().toISOString(), userId, sessionId);
  }

  function listAiChatSessions(userId: string) {
    const rows = db.prepare(
      `
      SELECT
        s.*,
        COUNT(m.id) AS message_count,
        MAX(m.created_at) AS latest_message_at
      FROM ai_chat_sessions s
      LEFT JOIN ai_chat_messages m ON m.session_id = s.id AND m.user_id = s.user_id
      WHERE s.user_id = ?
      GROUP BY s.id
      ORDER BY s.updated_at DESC
      `,
    ).all(userId) as Array<Record<string, unknown>>;

    return rows.map(parseChatSessionRow);
  }

  function getAiChatSession(userId: string, sessionId: string) {
    const row = db.prepare(
      `
      SELECT
        s.*,
        COUNT(m.id) AS message_count,
        MAX(m.created_at) AS latest_message_at
      FROM ai_chat_sessions s
      LEFT JOIN ai_chat_messages m ON m.session_id = s.id AND m.user_id = s.user_id
      WHERE s.user_id = ? AND s.id = ?
      GROUP BY s.id
      `,
    ).get(userId, sessionId) as Record<string, unknown> | undefined;

    return row ? parseChatSessionRow(row) : null;
  }

  function saveAiChatMessage(input: SaveAiChatMessageInput) {
    const createdAt = new Date().toISOString();
    db.prepare(
      `
      INSERT INTO ai_chat_messages (
        id, session_id, user_id, role, content, context_snapshot_json, token_estimate, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
    ).run(
      input.id,
      input.sessionId,
      input.userId,
      input.role,
      input.content,
      input.contextSnapshot ? JSON.stringify(input.contextSnapshot) : null,
      input.tokenEstimate ?? 0,
      createdAt,
    );
    touchAiChatSession(input.userId, input.sessionId);
  }

  function listAiChatMessages(userId: string, sessionId: string, limit?: number) {
    const cappedLimit = limit && Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : null;
    const rows = db.prepare(
      `
      SELECT *
      FROM ai_chat_messages
      WHERE user_id = ? AND session_id = ?
      ORDER BY created_at ASC
      ${cappedLimit ? "LIMIT ?" : ""}
      `,
    ).all(...(cappedLimit ? [userId, sessionId, String(cappedLimit)] : [userId, sessionId])) as Array<Record<string, unknown>>;

    return rows.map(parseChatMessageRow);
  }

  function getAiChatMessage(userId: string, messageId: string) {
    const row = db.prepare(
      `
      SELECT *
      FROM ai_chat_messages
      WHERE user_id = ? AND id = ?
      `,
    ).get(userId, messageId) as Record<string, unknown> | undefined;

    return row ? parseChatMessageRow(row) : null;
  }

  function deleteAiChatSession(userId: string, sessionId: string) {
    db.prepare("DELETE FROM ai_chat_messages WHERE user_id = ? AND session_id = ?").run(userId, sessionId);
    db.prepare("DELETE FROM ai_agent_runs WHERE user_id = ? AND session_id = ?").run(userId, sessionId);
    const result = db.prepare("DELETE FROM ai_chat_sessions WHERE user_id = ? AND id = ?").run(userId, sessionId);
    return result.changes > 0;
  }

  function clearAiChatMessages(userId: string, sessionId: string) {
    const result = db.prepare("DELETE FROM ai_chat_messages WHERE user_id = ? AND session_id = ?").run(userId, sessionId);
    db.prepare("DELETE FROM ai_agent_runs WHERE user_id = ? AND session_id = ?").run(userId, sessionId);
    touchAiChatSession(userId, sessionId);
    return result.changes;
  }

  function clearAiChatByUserId(userId: string) {
    db.prepare("DELETE FROM ai_chat_messages WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM ai_agent_runs WHERE user_id = ?").run(userId);
    const result = db.prepare("DELETE FROM ai_chat_sessions WHERE user_id = ?").run(userId);
    return result.changes;
  }

  function saveAiAgentRun(input: SaveAiAgentRunInput) {
    db.prepare(
      `
      INSERT INTO ai_agent_runs (
        id, session_id, user_id, message_id, intent, response_mode,
        plan_json, skill_calls_json, skill_results_json, context_stats_json, error, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    ).run(
      input.id,
      input.sessionId,
      input.userId,
      input.messageId ?? null,
      input.intent,
      input.responseMode,
      JSON.stringify(input.plan),
      JSON.stringify(input.skillCalls),
      JSON.stringify(input.skillResults),
      JSON.stringify(input.contextStats),
      input.error ?? null,
      new Date().toISOString(),
    );
  }

  function listAiAgentRuns(userId: string, sessionId: string, limit?: number) {
    const cappedLimit = limit && Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : null;
    const rows = db.prepare(
      `
      SELECT *
      FROM ai_agent_runs
      WHERE user_id = ? AND session_id = ?
      ORDER BY created_at ASC
      ${cappedLimit ? "LIMIT ?" : ""}
      `,
    ).all(...(cappedLimit ? [userId, sessionId, String(cappedLimit)] : [userId, sessionId])) as Array<Record<string, unknown>>;

    return rows.map(parseAiAgentRunRow);
  }

  function getAiAgentRun(userId: string, runId: string) {
    const row = db.prepare(
      `
      SELECT *
      FROM ai_agent_runs
      WHERE user_id = ? AND id = ?
      `,
    ).get(userId, runId) as Record<string, unknown> | undefined;

    return row ? parseAiAgentRunRow(row) : null;
  }

  return {
    dbPath,
    getPortfolioByUserId,
    getLatestNonEmptyLocalPortfolio,
    savePortfolioByUserId,
    saveAiAnalysis,
    listAiAnalysisByUserId,
    deleteAiAnalysisById,
    saveAiChatSession,
    updateAiChatSessionTitle,
    getAiChatSession,
    listAiChatSessions,
    saveAiChatMessage,
    getAiChatMessage,
    listAiChatMessages,
    deleteAiChatSession,
    clearAiChatMessages,
    clearAiChatByUserId,
    saveAiAgentRun,
    getAiAgentRun,
    listAiAgentRuns,
    setSessionContext,
    getSessionContext,
    rawInsert,
    close,
  };
}

type PortfolioStore = ReturnType<typeof createPortfolioStore>;

let portfolioStore: PortfolioStore | null = null;

function getPortfolioStore() {
  if (!portfolioStore) {
    portfolioStore = createPortfolioStore();
  }
  return portfolioStore;
}

export function getPortfolioByUserId(userId: string): StoredPayload {
  return getPortfolioStore().getPortfolioByUserId(userId);
}

export function getPortfolioByUserIdWithLocalFallback(userId: string): ResolvedStoredPayload {
  const store = getPortfolioStore();
  const payload = store.getPortfolioByUserId(userId);
  if (payload.stocks.length > 0 || !userId.startsWith("local:")) {
    return { ...payload, userId };
  }

  const fallback = store.getLatestNonEmptyLocalPortfolio();
  if (fallback && fallback.userId !== userId) {
    return fallback;
  }

  return { ...payload, userId };
}

export function savePortfolioByUserId(userId: string, payload: StoredPayload) {
  getPortfolioStore().savePortfolioByUserId(userId, payload);
}

export function saveAiAnalysis(record: SaveAiAnalysisInput) {
  getPortfolioStore().saveAiAnalysis(record);
}

export function listAiAnalysisByUserId(userId: string, filters: ListAiAnalysisFilters = {}) {
  return getPortfolioStore().listAiAnalysisByUserId(userId, filters);
}

export function deleteAiAnalysisById(userId: string, id: string) {
  return getPortfolioStore().deleteAiAnalysisById(userId, id);
}

export function saveAiChatSession(input: SaveAiChatSessionInput) {
  getPortfolioStore().saveAiChatSession(input);
}

export function updateAiChatSessionTitle(userId: string, sessionId: string, title: string) {
  getPortfolioStore().updateAiChatSessionTitle(userId, sessionId, title);
}

export function setSessionContext(userId: string, sessionId: string, context: Record<string, unknown> | null) {
  getPortfolioStore().setSessionContext(userId, sessionId, context);
}

export function getSessionContext(userId: string, sessionId: string) {
  return getPortfolioStore().getSessionContext(userId, sessionId);
}

export function getAiChatSession(userId: string, sessionId: string) {
  return getPortfolioStore().getAiChatSession(userId, sessionId);
}

export function listAiChatSessions(userId: string) {
  return getPortfolioStore().listAiChatSessions(userId);
}

export function saveAiChatMessage(input: SaveAiChatMessageInput) {
  getPortfolioStore().saveAiChatMessage(input);
}

export function getAiChatMessage(userId: string, messageId: string) {
  return getPortfolioStore().getAiChatMessage(userId, messageId);
}

export function listAiChatMessages(userId: string, sessionId: string, limit?: number) {
  return getPortfolioStore().listAiChatMessages(userId, sessionId, limit);
}

export function deleteAiChatSession(userId: string, sessionId: string) {
  return getPortfolioStore().deleteAiChatSession(userId, sessionId);
}

export function clearAiChatMessages(userId: string, sessionId: string) {
  return getPortfolioStore().clearAiChatMessages(userId, sessionId);
}

export function clearAiChatByUserId(userId: string) {
  return getPortfolioStore().clearAiChatByUserId(userId);
}

export function saveAiAgentRun(input: SaveAiAgentRunInput) {
  getPortfolioStore().saveAiAgentRun(input);
}

export function getAiAgentRun(userId: string, runId: string) {
  return getPortfolioStore().getAiAgentRun(userId, runId);
}

export function listAiAgentRuns(userId: string, sessionId: string, limit?: number) {
  return getPortfolioStore().listAiAgentRuns(userId, sessionId, limit);
}
