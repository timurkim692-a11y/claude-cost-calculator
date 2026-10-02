import { describe, expect, it } from "vitest";
import { MODELS, compareModels, estimateCost } from "./pricing";

describe("compareModels", () => {
  it("считает все модели и сортирует по стоимости", () => {
    const rows = compareModels("high", "M");
    expect(rows).toHaveLength(MODELS.length);
    const totals = rows.map((r) => r.estimate.cost.total);
    expect(totals).toEqual([...totals].sort((a, b) => a - b));
    expect(rows[0].modelId).toBe("claude-haiku-4-5");
  });

  it("берёт effort по умолчанию, если модель не умеет выбранный", () => {
    const rows = compareModels("xhigh", "S");
    const sonnet46 = rows.find((r) => r.modelId === "claude-sonnet-4-6")!;
    expect(sonnet46.effortFallback).toBe(true);
    expect(sonnet46.estimate.effort).toBe("high");
    const opus55 = rows.find((r) => r.modelId === "claude-opus-5-5")!;
    expect(opus55.effortFallback).toBe(false);
    expect(opus55.estimate.effort).toBe("xhigh");
  });

  it("применяет fast mode только там, где он есть", () => {
    const rows = compareModels("high", { input: 1_000_000, output: 0 }, { fast: true });
    const opus55 = rows.find((r) => r.modelId === "claude-opus-5-5")!;
    expect(opus55.fastUnavailable).toBe(false);
    expect(opus55.estimate.cost.total).toBeCloseTo(8);
    const sonnet = rows.find((r) => r.modelId === "claude-sonnet-5-5")!;
    expect(sonnet.fastUnavailable).toBe(true);
    expect(sonnet.estimate.cost.total).toBeCloseTo(2);
  });
});

describe("estimateCost", () => {
  it("считает базовую стоимость по ценам модели", () => {
    // Sonnet 5.5: $2 / $10, effort high = ×1.0
    const r = estimateCost({
      modelId: "claude-sonnet-5-5",
      effort: "high",
      size: { input: 1_000_000, output: 1_000_000 },
    });
    expect(r.cost.input).toBeCloseTo(2);
    expect(r.cost.output).toBeCloseTo(10);
    expect(r.cost.total).toBeCloseTo(12);
  });

  it("использует готовые размеры задач", () => {
    // M = 30k / 5k на Opus 5.5 при high: 30k×$4 + 5k×$20
    const r = estimateCost({ modelId: "claude-opus-5-5", effort: "high", size: "M" });
    expect(r.tokens).toEqual({ input: 30_000, cachedInput: 0, output: 5_000 });
    expect(r.cost.total).toBeCloseTo(0.12 + 0.1);
  });

  it("берёт effort по умолчанию: medium у Opus 5.5, high у остальных", () => {
    expect(estimateCost({ modelId: "claude-opus-5-5", size: "S" }).effort).toBe("medium");
    expect(estimateCost({ modelId: "claude-sonnet-5-5", size: "S" }).effort).toBe("high");
  });

  it("effort масштабирует только выходные токены", () => {
    const size = { input: 10_000, output: 10_000 };
    const low = estimateCost({ modelId: "claude-opus-5", effort: "low", size });
    const max = estimateCost({ modelId: "claude-opus-5", effort: "max", size });
    expect(low.tokens.input).toBe(max.tokens.input);
    expect(low.tokens.output).toBe(4_000);
    expect(max.tokens.output).toBe(22_000);
  });

  it("Haiku 4.5 работает без effort и отклоняет его", () => {
    const r = estimateCost({ modelId: "claude-haiku-4-5", size: { input: 1_000_000, output: 0 } });
    expect(r.effort).toBeNull();
    expect(r.cost.total).toBeCloseTo(1);
    expect(() => estimateCost({ modelId: "claude-haiku-4-5", effort: "high", size: "S" })).toThrow();
  });

  it("отклоняет effort, которого нет у модели", () => {
    expect(() => estimateCost({ modelId: "claude-sonnet-4-6", effort: "xhigh", size: "S" })).toThrow();
  });

  it("применяет цену чтения кэша конкретной модели", () => {
    const size = { input: 1_000_000, output: 0 };
    // Opus 5.5: кэш $0.20 (0.05×). Половина из кэша: 0.5×$4 + 0.5×$0.20
    const opus = estimateCost({ modelId: "claude-opus-5-5", size, options: { cacheHitRate: 0.5 } });
    expect(opus.tokens.cachedInput).toBe(500_000);
    expect(opus.cost.total).toBeCloseTo(2 + 0.1);
    // Fable 5.1: кэш $0.25 (0.025×)
    const fable = estimateCost({ modelId: "claude-fable-5-1", size, options: { cacheHitRate: 1 } });
    expect(fable.cost.total).toBeCloseTo(0.25);
  });

  it("Batch API даёт −50% на всё", () => {
    const size = { input: 1_000_000, output: 1_000_000 };
    const std = estimateCost({ modelId: "claude-opus-5", effort: "high", size });
    const batch = estimateCost({ modelId: "claude-opus-5", effort: "high", size, options: { batch: true } });
    expect(batch.cost.total).toBeCloseTo(std.cost.total / 2);
    expect(batch.prices).toEqual({ input: 2.5, cachedInput: 0.25, output: 12.5 });
  });

  it("fast mode использует свои цены и кэш-множитель модели", () => {
    const size = { input: 1_000_000, output: 1_000_000 };
    const r = estimateCost({ modelId: "claude-opus-5-5", effort: "high", size, options: { fast: true } });
    expect(r.cost.total).toBeCloseTo(8 + 40);
    const cached = estimateCost({
      modelId: "claude-opus-5-5",
      effort: "high",
      size: { input: 1_000_000, output: 0 },
      options: { fast: true, cacheHitRate: 1 },
    });
    expect(cached.cost.total).toBeCloseTo(8 * 0.05);
  });

  it("fast mode недоступен на других моделях и с batch", () => {
    expect(() => estimateCost({ modelId: "claude-sonnet-5-5", size: "S", options: { fast: true } })).toThrow();
    expect(() =>
      estimateCost({ modelId: "claude-opus-5-5", size: "S", options: { fast: true, batch: true } }),
    ).toThrow();
  });

  it("умножает на количество запусков", () => {
    const one = estimateCost({ modelId: "claude-sonnet-5-5", size: "L" });
    const ten = estimateCost({ modelId: "claude-sonnet-5-5", size: "L", options: { runs: 10 } });
    expect(ten.cost.total).toBeCloseTo(one.cost.total * 10);
    expect(ten.tokens.output).toBe(one.tokens.output * 10);
  });

  it("валидирует входные данные", () => {
    expect(() => estimateCost({ modelId: "gpt-5", size: "S" })).toThrow(/Неизвестная модель/);
    expect(() => estimateCost({ modelId: "claude-opus-5", size: { input: -1, output: 0 } })).toThrow();
    expect(() => estimateCost({ modelId: "claude-opus-5", size: "S", options: { cacheHitRate: 1.5 } })).toThrow();
    expect(() => estimateCost({ modelId: "claude-opus-5", size: "S", options: { runs: 0 } })).toThrow();
  });

  it("у каждой модели корректные данные", () => {
    for (const m of MODELS) {
      expect(m.cacheRead).toBeLessThan(m.input);
      if (m.defaultEffort) expect(m.efforts).toContain(m.defaultEffort);
      else expect(m.efforts).toEqual([]);
    }
  });
});
