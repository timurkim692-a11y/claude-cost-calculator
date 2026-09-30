import { describe, expect, it } from "vitest";
import { formatPrice, formatTokens, formatTokensShort, formatUsd } from "./format";

// Intl вставляет неразрывные пробелы; для сравнения заменяем их обычными.
const plain = (s: string) => s.replace(/[  ]/g, " ");

describe("format", () => {
  it("formatUsd подбирает точность под величину суммы", () => {
    expect(plain(formatUsd(12.345))).toBe("12,35 $");
    expect(plain(formatUsd(0.22))).toBe("0,220 $");
    expect(plain(formatUsd(0.00042))).toBe("0,0004 $");
    expect(plain(formatUsd(0))).toBe("0,00 $");
  });

  it("formatTokens группирует разряды", () => {
    expect(plain(formatTokens(150000))).toBe("150 000");
  });

  it("formatTokensShort сокращает до k и M", () => {
    expect(formatTokensShort(500)).toBe("500");
    expect(formatTokensShort(5000)).toBe("5k");
    expect(formatTokensShort(1_500_000)).toBe("1.5M");
  });

  it("formatPrice убирает лишние нули", () => {
    expect(formatPrice(4)).toBe("$4");
    expect(formatPrice(0.2)).toBe("$0.2");
    expect(formatPrice(12.5)).toBe("$12.5");
  });
});
