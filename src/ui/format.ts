/** Доллары: у мелких сумм больше знаков, чтобы $0.0004 не превращались в $0.00. */
export function formatUsd(value: number): string {
  const abs = Math.abs(value);
  const digits = abs === 0 || abs >= 1 ? 2 : abs >= 0.01 ? 3 : 4;
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

export function formatTokens(value: number): string {
  return new Intl.NumberFormat("ru-RU").format(value);
}

/** Короткая запись размера: 5000 → «5k», 1 500 000 → «1.5M». */
export function formatTokensShort(value: number): string {
  if (value >= 1_000_000) return `${+(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${+(value / 1_000).toFixed(1)}k`;
  return String(value);
}

/** Цена за 1M токенов: $4, $0.2, $12.5. */
export function formatPrice(value: number): string {
  return `$${+value.toFixed(2)}`;
}
