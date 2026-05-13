import { DEFAULT_FEE_CONFIGS } from "@/config/defaults";
import type {
  FeeConfig,
  Market,
  Stock,
  StockSummary,
  Trade,
  TradePnlDetail,
} from "@/types";
import { roundMoney, roundTo, calcCommission, calcAmount, calcPerShareCost, calcPnl, calcPnlPercent, add, sub, mul } from "./money";

type FeeBreakdown = {
  commission: number;
  tax: number;
  transferFee: number;
  netAmount: number;
};

type MainlandFeeProfile = "A_STOCK" | "A_ETF_OR_FUND";

type CostLot = {
  tradeId: string;
  acquiredDate: string;
  price: number;
  quantity: number;
  dividendGrossPerShare: number;
};

type MatchSellInput = {
  quantity: number;
  costQueue: CostLot[];
  sellDate?: string;
};

type MatchSellResult = {
  costBasis: number;
  deferredDividendTax: number;
};

const QUANTITY_EPSILON = 1e-12;

function normalizeQuantity(value: number) {
  return Math.abs(value) < QUANTITY_EPSILON ? 0 : value;
}

function addCalendarMonths(date: Date, months: number) {
  const result = new Date(date);
  const originalDay = result.getDate();
  result.setDate(1);
  result.setMonth(result.getMonth() + months);
  const lastDay = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
  result.setDate(Math.min(originalDay, lastDay));
  return result;
}

function dividendTaxRateByHoldingPeriod(acquiredDate: string, sellDate: string) {
  const acquired = new Date(`${acquiredDate}T00:00:00`);
  const sold = new Date(`${sellDate}T00:00:00`);
  if (Number.isNaN(acquired.getTime()) || Number.isNaN(sold.getTime())) return 0;

  if (sold <= addCalendarMonths(acquired, 1)) return 0.2;
  if (sold <= addCalendarMonths(acquired, 12)) return 0.1;
  return 0;
}

function matchSellLots({ quantity, costQueue, sellDate }: MatchSellInput): MatchSellResult {
  let remaining = quantity;
  let costBasis = 0;
  let deferredDividendTax = 0;

  while (remaining > QUANTITY_EPSILON && costQueue.length > 0) {
    const lot = costQueue[0];
    const matchedQuantity = Math.min(lot.quantity, remaining);

    if (sellDate && lot.dividendGrossPerShare > 0) {
      deferredDividendTax = add(
        deferredDividendTax,
        mul(
          mul(lot.dividendGrossPerShare, matchedQuantity),
          dividendTaxRateByHoldingPeriod(lot.acquiredDate, sellDate),
        ),
      );
    }

    if (lot.quantity <= remaining + QUANTITY_EPSILON) {
      costBasis = add(costBasis, mul(lot.price, lot.quantity));
      remaining = normalizeQuantity(sub(remaining, lot.quantity));
      costQueue.shift();
    } else {
      costBasis = add(costBasis, mul(lot.price, remaining));
      lot.quantity = normalizeQuantity(sub(lot.quantity, remaining));
      remaining = 0;
    }
  }

  return { costBasis, deferredDividendTax: roundMoney(deferredDividendTax) };
}

function getCostQueueQuantity(costQueue: CostLot[]) {
  return costQueue.reduce((sum, item) => add(sum, item.quantity), 0);
}

function getCostQueueCost(costQueue: CostLot[]) {
  return costQueue.reduce((sum, item) => add(sum, mul(item.price, item.quantity)), 0);
}

function applyDividendToCostQueue(dividendAmount: number, dividendQuantity: number, costQueue: CostLot[], taxableAtSell: boolean) {
  const currentQuantity = getCostQueueQuantity(costQueue);
  const currentCost = getCostQueueCost(costQueue);
  const eligibleQuantity = Math.min(dividendQuantity, currentQuantity);
  if (dividendAmount <= 0 || eligibleQuantity <= QUANTITY_EPSILON || currentCost <= 0) {
    return { appliedAmount: 0, excessAmount: dividendAmount };
  }

  const appliedAmount = Math.min(dividendAmount, currentCost);
  const perShareReduction = calcPerShareCost(appliedAmount, eligibleQuantity);
  const grossDividendPerShare = calcPerShareCost(dividendAmount, eligibleQuantity);
  let remainingQuantity = eligibleQuantity;

  for (let index = 0; index < costQueue.length && remainingQuantity > QUANTITY_EPSILON; index++) {
    const lot = costQueue[index];
    const appliedQuantity = Math.min(lot.quantity, remainingQuantity);
    if (appliedQuantity < lot.quantity - QUANTITY_EPSILON) {
      const eligibleLot: CostLot = { ...lot, quantity: appliedQuantity };
      const untouchedLot: CostLot = {
        ...lot,
        quantity: normalizeQuantity(sub(lot.quantity, appliedQuantity)),
      };
      costQueue.splice(index, 1, eligibleLot, untouchedLot);
      eligibleLot.price = Math.max(0, sub(eligibleLot.price, perShareReduction));
      if (taxableAtSell) {
        eligibleLot.dividendGrossPerShare = add(eligibleLot.dividendGrossPerShare, grossDividendPerShare);
      }
      remainingQuantity = normalizeQuantity(sub(remainingQuantity, appliedQuantity));
      continue;
    }
    lot.price = Math.max(0, sub(lot.price, perShareReduction));
    if (taxableAtSell) {
      lot.dividendGrossPerShare = add(lot.dividendGrossPerShare, grossDividendPerShare);
    }
    remainingQuantity = normalizeQuantity(sub(remainingQuantity, appliedQuantity));
  }

  return {
    appliedAmount,
    excessAmount: normalizeQuantity(sub(dividendAmount, appliedAmount)),
  };
}

function getMainlandFeeProfile(
  market: Market,
  stockCode?: string,
): MainlandFeeProfile | null {
  if (market === "FUND") return "A_ETF_OR_FUND";
  if (market !== "A") return null;
  if (!stockCode) return "A_STOCK";

  const normalized = stockCode.trim().toUpperCase();
  const etfPrefixes = ["5", "15", "16", "18"];
  return etfPrefixes.some((prefix) => normalized.startsWith(prefix))
    ? "A_ETF_OR_FUND"
    : "A_STOCK";
}

function isMainlandTaxableStock(stock: Pick<Stock, "market" | "code">) {
  return getMainlandFeeProfile(stock.market, stock.code) === "A_STOCK";
}

function dividendCashAmountForSummary(stock: Stock, trade: Trade) {
  if (isMainlandTaxableStock(stock)) {
    return trade.totalAmount > 0 ? trade.totalAmount : trade.netAmount;
  }
  return trade.netAmount;
}

function calcBuyCharges(
  totalAmount: number,
  config: FeeConfig,
  market: Market,
  stockCode?: string,
): FeeBreakdown {
  const commission = calcCommission(totalAmount, config.commissionRate, config.minCommission);
  const mainlandProfile = getMainlandFeeProfile(market, stockCode);

  let stampDuty = 0;
  let transferFee = 0;
  let settlementFee = 0;

  if (market === "HK") {
    stampDuty = roundMoney(mul(totalAmount, config.stampDutyRate));
    settlementFee = roundMoney(mul(totalAmount, config.settlementFeeRate ?? 0));
  } else if (mainlandProfile === "A_STOCK") {
    transferFee = roundMoney(mul(totalAmount, config.transferFeeRate));
  }

  const tax = roundMoney(add(stampDuty, add(transferFee, settlementFee)));
  const netAmount = roundMoney(add(totalAmount, add(commission, tax)));
  return { commission, tax, transferFee, netAmount };
}

function calcSellCharges(
  totalAmount: number,
  config: FeeConfig,
  market: Market,
  stockCode?: string,
): FeeBreakdown {
  const commission = calcCommission(totalAmount, config.commissionRate, config.minCommission);
  const mainlandProfile = getMainlandFeeProfile(market, stockCode);

  let stampDuty = 0;
  let transferFee = 0;
  let settlementFee = 0;

  if (market === "HK") {
    stampDuty = roundMoney(mul(totalAmount, config.stampDutyRate));
    settlementFee = roundMoney(mul(totalAmount, config.settlementFeeRate ?? 0));
  } else if (mainlandProfile === "A_STOCK") {
    stampDuty = roundMoney(mul(totalAmount, config.stampDutyRate));
    transferFee = roundMoney(mul(totalAmount, config.transferFeeRate));
  }

  const tax = roundMoney(add(stampDuty, add(transferFee, settlementFee)));
  const netAmount = roundMoney(sub(sub(totalAmount, commission), tax));
  return { commission, tax, transferFee, netAmount };
}

// 计算单笔买入的实际成本（含手续费）
export function calcBuyNetAmount(
  price: number,
  quantity: number,
  config: FeeConfig,
  market?: Market,
  stockCode?: string,
): FeeBreakdown {
  const totalAmount = calcAmount(price, quantity);
  return calcBuyCharges(totalAmount, config, market ?? config.market, stockCode);
}

// 计算单笔卖出的实际到账（扣手续费）
export function calcSellNetAmount(
  price: number,
  quantity: number,
  config: FeeConfig,
  stockCode?: string,
): FeeBreakdown {
  const totalAmount = calcAmount(price, quantity);
  return calcSellCharges(totalAmount, config, config.market, stockCode);
}

// 自动计算手续费并生成Trade对象的费用字段
export function autoCalcFees(
  type: "BUY" | "SELL",
  price: number,
  quantity: number,
  market: Market,
  stockCode?: string,
  config?: FeeConfig,
): { commission: number; tax: number; netAmount: number } {
  const feeConfig = config ?? DEFAULT_FEE_CONFIGS[market];
  if (type === "BUY") {
    const { commission, tax, netAmount } = calcBuyNetAmount(
      price,
      quantity,
      feeConfig,
      market,
      stockCode,
    );
    return { commission, tax, netAmount };
  } else {
    const { commission, tax, netAmount } = calcSellNetAmount(
      price,
      quantity,
      feeConfig,
      stockCode,
    );
    return { commission, tax, netAmount };
  }
}

export function estimateDeferredDividendTax(
  stock: Stock,
  sellDate: string,
  sellQuantity: number,
): number {
  if (!isMainlandTaxableStock(stock) || sellQuantity <= 0) return 0;

  const costQueue: CostLot[] = [];
  const trades = [...stock.trades]
    .filter((trade) => trade.date < sellDate)
    .sort((a, b) => a.date.localeCompare(b.date));

  for (const trade of trades) {
    if (trade.type === "BUY") {
      costQueue.push({
        tradeId: trade.id,
        acquiredDate: trade.date,
        price: calcPerShareCost(trade.netAmount, trade.quantity),
        quantity: trade.quantity,
        dividendGrossPerShare: 0,
      });
    } else if (trade.type === "SELL") {
      matchSellLots({ quantity: trade.quantity, costQueue, sellDate: trade.date });
    } else if (trade.type === "DIVIDEND") {
      const dividendAmount = dividendCashAmountForSummary(stock, trade);
      applyDividendToCostQueue(dividendAmount, trade.quantity, costQueue, true);
    }
  }

  return matchSellLots({ quantity: sellQuantity, costQueue, sellDate }).deferredDividendTax;
}

// 计算单个标的整体盈亏摘要（卖出明细按 FIFO 匹配成本批次）
// 支持：BUY / SELL / DIVIDEND
export function calcStockSummary(
  stock: Stock,
  currentPrice?: number,
): StockSummary {
  const trades = [...stock.trades].sort((a, b) => a.date.localeCompare(b.date));

  let totalBuyAmount = 0;
  let totalSellAmount = 0;
  let totalCommission = 0;
  let currentHolding = 0;
  let realizedPnl = 0;
  let totalDividend = 0;
  let tradeCount = 0;
  let displayCostBasis = 0;
  let embeddedRealizedPnl = 0;

  // 成本批次队列：{ price: 每股摊薄成本, quantity: 数量 }
  const costQueue: CostLot[] = [];

  // 每笔交易盈亏明细
  const tradePnlDetails: TradePnlDetail[] = [];

  for (const trade of trades) {
    if (trade.type === "BUY") {
      tradeCount++;
      totalCommission = add(totalCommission, add(trade.commission, trade.tax));
      totalBuyAmount = add(totalBuyAmount, trade.netAmount);
      currentHolding = normalizeQuantity(add(currentHolding, trade.quantity));
      displayCostBasis = add(displayCostBasis, trade.netAmount);
      costQueue.push({
        tradeId: trade.id,
        acquiredDate: trade.date,
        price: calcPerShareCost(trade.netAmount, trade.quantity),
        quantity: trade.quantity,
        dividendGrossPerShare: 0,
      });

      tradePnlDetails.push({
        tradeId: trade.id,
        type: "BUY",
        date: trade.date,
        pnl: 0,
        pnlPercent: 0,
        costBasis: trade.netAmount,
        proceeds: 0,
        holdingAfterTrade: currentHolding,
      });
    } else if (trade.type === "SELL") {
      tradeCount++;
      const { costBasis, deferredDividendTax } = matchSellLots({
        quantity: trade.quantity,
        costQueue,
        sellDate: trade.date,
      });
      const effectiveDeferredDividendTax = trade.deferredDividendTax ?? deferredDividendTax;
      const effectiveNetAmount = trade.deferredDividendTax === undefined && effectiveDeferredDividendTax > 0
        ? sub(trade.netAmount, effectiveDeferredDividendTax)
        : trade.netAmount;
      totalCommission = add(totalCommission, add(trade.commission, add(trade.tax, trade.deferredDividendTax === undefined ? effectiveDeferredDividendTax : 0)));
      totalSellAmount = add(totalSellAmount, effectiveNetAmount);

      const pnl = calcPnl(effectiveNetAmount, costBasis);
      const pnlPercent = calcPnlPercent(pnl, costBasis);
      realizedPnl = add(realizedPnl, pnl);
      currentHolding = normalizeQuantity(sub(currentHolding, trade.quantity));
      displayCostBasis = sub(displayCostBasis, effectiveNetAmount);
      if (currentHolding <= QUANTITY_EPSILON) {
        displayCostBasis = 0;
        embeddedRealizedPnl = 0;
      } else {
        embeddedRealizedPnl = add(embeddedRealizedPnl, pnl);
      }

      tradePnlDetails.push({
        tradeId: trade.id,
        type: "SELL",
        date: trade.date,
        pnl,
        pnlPercent,
        costBasis,
        proceeds: effectiveNetAmount,
        holdingAfterTrade: currentHolding,
      });
    } else if (trade.type === "DIVIDEND") {
      const dividendAmount = dividendCashAmountForSummary(stock, trade);
      totalDividend = add(totalDividend, dividendAmount);
      const { excessAmount } = applyDividendToCostQueue(
        dividendAmount,
        trade.quantity,
        costQueue,
        isMainlandTaxableStock(stock),
      );
      realizedPnl = add(realizedPnl, excessAmount);
      if (currentHolding > QUANTITY_EPSILON) {
        displayCostBasis = sub(displayCostBasis, dividendAmount);
        embeddedRealizedPnl = add(embeddedRealizedPnl, excessAmount);
      }

      tradePnlDetails.push({
        tradeId: trade.id,
        type: "DIVIDEND",
        date: trade.date,
        pnl: dividendAmount,
        pnlPercent: 0,
        costBasis: 0,
        proceeds: dividendAmount,
        holdingAfterTrade: currentHolding,
        isDividend: true,
      });
    }
  }

  const remainingQuantityByTradeId = new Map<string, number>();
  for (const item of costQueue) {
    remainingQuantityByTradeId.set(
      item.tradeId,
      (remainingQuantityByTradeId.get(item.tradeId) ?? 0) + item.quantity,
    );
  }

  const normalizedTradePnlDetails = tradePnlDetails.map((detail) =>
    detail.type === "BUY"
      ? {
          ...detail,
          soldQuantity:
            normalizeQuantity(sub(
              stock.trades.find((trade) => trade.id === detail.tradeId)?.quantity ?? 0,
              remainingQuantityByTradeId.get(detail.tradeId) ?? 0,
            )),
          remainingQuantity: normalizeQuantity(remainingQuantityByTradeId.get(detail.tradeId) ?? 0),
        }
      : detail,
  );

  // 当前持仓成本价采用券商常见摊薄口径：买入增加成本，卖出实收和现金收益降低成本；清仓后重置。
  const remainingCost = currentHolding > 0 ? displayCostBasis : 0;
  const avgCostPrice = currentHolding > 0 ? roundTo(calcPerShareCost(remainingCost, currentHolding), 6) : 0;
  const unrealizedPnl =
    currentHolding > 0 && currentPrice
      ? sub(mul(currentPrice, currentHolding), remainingCost)
      : 0;

  const totalPnl =
    currentHolding > 0 && currentPrice
      ? sub(add(realizedPnl, unrealizedPnl), embeddedRealizedPnl)
      : realizedPnl;
  const totalInvested = totalBuyAmount;
  const totalPnlPercent =
    totalInvested > 0 ? calcPnlPercent(totalPnl, totalInvested) : 0;

  return {
    stock,
    totalBuyAmount,
    totalSellAmount,
    currentHolding,
    avgCostPrice,
    realizedPnl,
    unrealizedPnl,
    totalPnl,
    totalPnlPercent,
    totalCommission,
    totalDividend,
    tradeCount,
    tradePnlDetails: normalizedTradePnlDetails,
  };
}

// 格式化金额
export function formatAmount(value: number, decimals = 2): string {
  return value.toLocaleString("zh-CN", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

// 格式化盈亏（带+/-号）
export function formatPnl(
  value: number,
  currency = "CNY",
  decimals = 2,
): string {
  const sign = value >= 0 ? "+" : "-";
  const symbols: Record<string, string> = {
    CNY: "¥",
    HKD: "HK$",
    USD: "$",
    USDT: "$",
  };
  const symbol = symbols[currency] || "¥";
  return `${sign}${symbol}${formatAmount(Math.abs(value), decimals)}`;
}

// 格式化百分比
export function formatPercent(value: number, decimals = 2): string {
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(decimals)}%`;
}

function getRuntimeCrypto(): Crypto | undefined {
  return typeof globalThis !== "undefined" && typeof globalThis.crypto !== "undefined"
    ? globalThis.crypto
    : undefined;
}

function fillRandomBytes(bytes: Uint8Array) {
  const runtimeCrypto = getRuntimeCrypto();
  if (typeof runtimeCrypto?.getRandomValues === "function") {
    runtimeCrypto.getRandomValues(bytes);
    return;
  }

  for (let index = 0; index < bytes.length; index++) {
    bytes[index] = Math.floor(Math.random() * 256);
  }
}

function formatUuid(bytes: Uint8Array) {
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
  return [
    hex.slice(0, 4).join(""),
    hex.slice(4, 6).join(""),
    hex.slice(6, 8).join(""),
    hex.slice(8, 10).join(""),
    hex.slice(10, 16).join(""),
  ].join("-");
}

// 生成UUID，兼容不支持 crypto.randomUUID 的浏览器运行环境
export function generateId(): string {
  const runtimeCrypto = getRuntimeCrypto();
  if (typeof runtimeCrypto?.randomUUID === "function") {
    return runtimeCrypto.randomUUID();
  }

  const bytes = new Uint8Array(16);
  fillRandomBytes(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return formatUuid(bytes);
}

// 获取今天的日期字符串
export function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}
