import pricing from "./data/pricing.json";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";
export type SizeId = "S" | "M" | "L" | "XL";

export interface ModelPricing {
  id: string;
  name: string;
  /** Цены в USD за 1M токенов. */
  input: number;
  output: number;
  cacheRead: number;
  /** Пустой массив — модель не поддерживает effort (Haiku 4.5). */
  efforts: Effort[];
  defaultEffort: Effort | null;
  fast?: { input: number; output: number };
}

export interface Tokens {
  input: number;
  output: number;
}

export interface EstimateOptions {
  /** Доля входных токенов, прочитанных из кэша, 0..1. */
  cacheHitRate?: number;
  /** Batch API: −50% на все токены. */
  batch?: boolean;
  /** Fast mode (только Opus 5.5 / 5 / 4.8, несовместим с batch). */
  fast?: boolean;
  /** Сколько раз запускается задача. */
  runs?: number;
}

export interface EstimateInput {
  modelId: string;
  /** Не задан — берётся effort модели по умолчанию. */
  effort?: Effort;
  /** Готовый размер задачи или свои токены (для effort high). */
  size: SizeId | Tokens;
  options?: EstimateOptions;
}

export interface CostEstimate {
  model: string;
  effort: Effort | null;
  runs: number;
  /** Токены на все запуски. */
  tokens: { input: number; cachedInput: number; output: number };
  /** Итоговые цены за 1M токенов с учётом fast mode, кэша и batch. */
  prices: { input: number; cachedInput: number; output: number };
  /** Стоимость в USD на все запуски. */
  cost: { input: number; cachedInput: number; output: number; total: number };
}

export interface ModelComparison {
  modelId: string;
  estimate: CostEstimate;
  /** Модель не поддерживает выбранный effort — взят её effort по умолчанию. */
  effortFallback: boolean;
  /** Fast mode запрошен, но модель его не поддерживает — посчитано без него. */
  fastUnavailable: boolean;
}

const MTOK = 1_000_000;

export const PRICING_META = { updated: pricing.updated, source: pricing.source };
export const MODELS: ModelPricing[] = pricing.models as ModelPricing[];
export const SIZES = pricing.sizes as Record<SizeId, Tokens & { label: string }>;
export const EFFORT_MULTIPLIERS: Record<Effort, number> = {
  low: pricing.effortOutputMultipliers.low,
  medium: pricing.effortOutputMultipliers.medium,
  high: pricing.effortOutputMultipliers.high,
  xhigh: pricing.effortOutputMultipliers.xhigh,
  max: pricing.effortOutputMultipliers.max,
};

export function getModel(id: string): ModelPricing {
  const model = MODELS.find((m) => m.id === id);
  if (!model) throw new Error(`Неизвестная модель: ${id}`);
  return model;
}

function resolveEffort(model: ModelPricing, effort?: Effort): Effort | null {
  if (model.efforts.length === 0) {
    if (effort) throw new Error(`${model.name} не поддерживает effort`);
    return null;
  }
  const resolved = effort ?? model.defaultEffort!;
  if (!model.efforts.includes(resolved)) {
    throw new Error(`${model.name} не поддерживает effort "${resolved}"`);
  }
  return resolved;
}

function resolveTokens(size: SizeId | Tokens): Tokens {
  const tokens = typeof size === "string" ? SIZES[size] : size;
  if (!tokens) throw new Error(`Неизвестный размер задачи: ${String(size)}`);
  if (tokens.input < 0 || tokens.output < 0) {
    throw new Error("Количество токенов не может быть отрицательным");
  }
  return { input: tokens.input, output: tokens.output };
}

export function estimateCost({ modelId, effort, size, options = {} }: EstimateInput): CostEstimate {
  const model = getModel(modelId);
  const resolvedEffort = resolveEffort(model, effort);
  const base = resolveTokens(size);
  const { cacheHitRate = 0, batch = false, fast = false, runs = 1 } = options;

  if (cacheHitRate < 0 || cacheHitRate > 1) {
    throw new Error("cacheHitRate должен быть от 0 до 1");
  }
  if (!Number.isInteger(runs) || runs < 1) {
    throw new Error("runs должен быть целым числом ≥ 1");
  }
  if (fast && !model.fast) throw new Error(`${model.name} не поддерживает fast mode`);
  if (fast && batch) throw new Error("Fast mode несовместим с Batch API");

  // Effort меняет только выход (включая thinking); вход задаётся задачей.
  const outputMultiplier = resolvedEffort ? EFFORT_MULTIPLIERS[resolvedEffort] : 1;
  const inputTokens = base.input * runs;
  const outputTokens = Math.round(base.output * outputMultiplier) * runs;
  const cachedTokens = Math.round(inputTokens * cacheHitRate);
  const uncachedTokens = inputTokens - cachedTokens;

  // Скидка на кэш — множитель модели от базовой цены входа; в fast mode он применяется к цене fast.
  const cacheRatio = model.cacheRead / model.input;
  const inputPrice = fast ? model.fast!.input : model.input;
  const outputPrice = fast ? model.fast!.output : model.output;
  const discount = batch ? pricing.batchDiscount : 1;

  const prices = {
    input: inputPrice * discount,
    cachedInput: inputPrice * cacheRatio * discount,
    output: outputPrice * discount,
  };
  const inputCost = (uncachedTokens * prices.input) / MTOK;
  const cachedCost = (cachedTokens * prices.cachedInput) / MTOK;
  const outputCost = (outputTokens * prices.output) / MTOK;

  return {
    model: model.name,
    effort: resolvedEffort,
    runs,
    tokens: { input: uncachedTokens, cachedInput: cachedTokens, output: outputTokens },
    prices,
    cost: {
      input: inputCost,
      cachedInput: cachedCost,
      output: outputCost,
      total: inputCost + cachedCost + outputCost,
    },
  };
}

/**
 * Одна и та же задача на всех моделях, от дешёвой к дорогой.
 * Если модель не умеет выбранный effort или fast mode, считаем с её умолчаниями и помечаем это.
 */
export function compareModels(
  effort: Effort | undefined,
  size: SizeId | Tokens,
  options: EstimateOptions = {},
): ModelComparison[] {
  return MODELS.map((model) => {
    const effortFallback = !!effort && !model.efforts.includes(effort);
    const fastUnavailable = !!options.fast && !model.fast;
    const estimate = estimateCost({
      modelId: model.id,
      effort: effortFallback ? undefined : effort,
      size,
      options: fastUnavailable ? { ...options, fast: false } : options,
    });
    return { modelId: model.id, estimate, effortFallback, fastUnavailable };
  }).sort((a, b) => a.estimate.cost.total - b.estimate.cost.total);
}
