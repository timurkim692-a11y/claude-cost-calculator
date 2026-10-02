import {
  EFFORT_MULTIPLIERS,
  MODELS,
  PRICING_META,
  SIZES,
  compareModels,
  estimateCost,
  getModel,
  type CostEstimate,
  type Effort,
  type EstimateOptions,
  type SizeId,
  type Tokens,
} from "../pricing";
import { formatPrice, formatTokens, formatTokensShort, formatUsd } from "./format";

type SizeChoice = SizeId | "custom";

interface State {
  modelId: string;
  effort: Effort | null;
  size: SizeChoice;
  custom: { input: string; output: string };
  /** Доля входа из кэша в процентах. */
  cache: number;
  batch: boolean;
  fast: boolean;
  runs: string;
}

const EFFORT_HINTS: Record<Effort, string> = {
  low: "простые задачи, субагенты",
  medium: "баланс цены и качества",
  high: "сложные задачи",
  xhigh: "код и агенты",
  max: "когда качество важнее цены",
};

const DEFAULT_MODEL = "claude-opus-5-5";

export function mountApp(root: HTMLElement): void {
  const initial = getModel(DEFAULT_MODEL);
  const state: State = {
    modelId: initial.id,
    effort: initial.defaultEffort,
    size: "M",
    custom: { input: String(SIZES.M.input), output: String(SIZES.M.output) },
    cache: 0,
    batch: false,
    fast: false,
    runs: "1",
  };

  root.innerHTML = `
    <main class="page">
      <header class="header">
        <h1>Калькулятор стоимости Claude</h1>
        <p class="lead">Сколько стоит задача по API-тарифам Anthropic: выберите модель, effort и размер задачи.</p>
      </header>

      <div class="layout">
        <form class="card form" id="form" novalidate>
          <div class="field">
            <label class="field-label" for="model">Модель</label>
            <select id="model" name="model">
              ${MODELS.map(
                (m) =>
                  `<option value="${m.id}">${m.name} — ${formatPrice(m.input)} / ${formatPrice(m.output)}</option>`,
              ).join("")}
            </select>
            <p class="hint">Цена за 1M токенов: вход / выход</p>
          </div>

          <fieldset class="field">
            <legend class="field-label">Effort</legend>
            <div id="effort"></div>
            <p class="hint" id="effort-hint"></p>
          </fieldset>

          <fieldset class="field">
            <legend class="field-label">Размер задачи</legend>
            <div class="segmented" style="--cols: ${Object.keys(SIZES).length + 1}">
              ${(Object.keys(SIZES) as SizeId[])
                .map(
                  (id) => `
                <label class="seg">
                  <input type="radio" name="size" value="${id}" />
                  <span><b>${id}</b><small>${formatTokensShort(SIZES[id].input)} / ${formatTokensShort(SIZES[id].output)}</small></span>
                </label>`,
                )
                .join("")}
              <label class="seg">
                <input type="radio" name="size" value="custom" />
                <span><b>Своё</b><small>токены</small></span>
              </label>
            </div>
            <div class="pair" id="custom" hidden>
              <label>Вход, токенов
                <input type="number" name="customInput" min="0" step="1000" inputmode="numeric" />
              </label>
              <label>Выход, токенов
                <input type="number" name="customOutput" min="0" step="1000" inputmode="numeric" />
              </label>
            </div>
            <p class="hint">Выход указан для effort high; другие уровни effort его масштабируют.</p>
          </fieldset>

          <fieldset class="field">
            <legend class="field-label">Опции</legend>
            <label class="range">
              <span class="range-head">Доля входа из кэша <output id="cache-value"></output></span>
              <input type="range" name="cache" min="0" max="100" step="5" />
            </label>
            <div class="checks">
              <label class="check">
                <input type="checkbox" name="batch" />
                <span><b>Batch API</b><small>−50% на всё, ответ в течение 24 ч</small></span>
              </label>
              <label class="check">
                <input type="checkbox" name="fast" />
                <span><b>Fast mode</b><small>до 2,5× быстрее, цена выше</small></span>
              </label>
            </div>
            <p class="hint" id="options-hint"></p>
            <div class="pair">
              <label>Запусков задачи
                <input type="number" name="runs" min="1" step="1" inputmode="numeric" />
              </label>
            </div>
          </fieldset>
        </form>

        <section class="card result" id="result" aria-live="polite"></section>
      </div>

      <section class="card compare">
        <h2>Эта задача на всех моделях</h2>
        <p class="hint">Те же размер, effort и опции. Нажмите на модель, чтобы выбрать её.</p>
        <div id="compare"></div>
      </section>

      <footer class="footer">
        <p>
          Цены Anthropic API на ${new Date(PRICING_META.updated).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })}
          · <a href="${PRICING_META.source}" target="_blank" rel="noopener">источник</a>
          · <a href="https://github.com/timurkim692-a11y/claude-cost-calculator#как-считается" target="_blank" rel="noopener">методика расчёта</a>
        </p>
        <p>На подписке Pro/Max задачи в пределах лимитов не оплачиваются отдельно — по этим тарифам считаются usage credits сверх лимита и fast mode.</p>
      </footer>
    </main>
  `;

  const form = root.querySelector<HTMLFormElement>("#form")!;
  const modelSelect = form.querySelector<HTMLSelectElement>("#model")!;
  const effortBox = form.querySelector<HTMLDivElement>("#effort")!;
  const effortHint = form.querySelector<HTMLParagraphElement>("#effort-hint")!;
  const customBox = form.querySelector<HTMLDivElement>("#custom")!;
  const cacheInput = form.querySelector<HTMLInputElement>('[name="cache"]')!;
  const cacheValue = form.querySelector<HTMLOutputElement>("#cache-value")!;
  const batchInput = form.querySelector<HTMLInputElement>('[name="batch"]')!;
  const fastInput = form.querySelector<HTMLInputElement>('[name="fast"]')!;
  const optionsHint = form.querySelector<HTMLParagraphElement>("#options-hint")!;
  const result = root.querySelector<HTMLElement>("#result")!;
  const compare = root.querySelector<HTMLDivElement>("#compare")!;

  modelSelect.value = state.modelId;
  form.querySelector<HTMLInputElement>(`[name="size"][value="${state.size}"]`)!.checked = true;
  form.querySelector<HTMLInputElement>('[name="customInput"]')!.value = state.custom.input;
  form.querySelector<HTMLInputElement>('[name="customOutput"]')!.value = state.custom.output;
  form.querySelector<HTMLInputElement>('[name="runs"]')!.value = state.runs;
  cacheInput.value = String(state.cache);

  function setModel(id: string): void {
    state.modelId = id;
    modelSelect.value = id;
    const model = getModel(id);
    // Выбранный effort сохраняем, если новая модель его поддерживает.
    if (model.efforts.length === 0) state.effort = null;
    else if (!state.effort || !model.efforts.includes(state.effort)) state.effort = model.defaultEffort;
    if (!model.fast) state.fast = false;
    renderEffort();
    renderOptions();
  }

  function renderEffort(): void {
    const model = getModel(state.modelId);
    if (model.efforts.length === 0) {
      effortBox.innerHTML = "";
      effortHint.textContent = `${model.name} не поддерживает effort.`;
      return;
    }
    effortBox.innerHTML = `<div class="segmented" style="--cols: ${model.efforts.length}">${model.efforts
      .map(
        (e) => `
      <label class="seg" title="${EFFORT_HINTS[e]}">
        <input type="radio" name="effort" value="${e}" ${e === state.effort ? "checked" : ""} />
        <span><b>${e}${e === model.defaultEffort ? '<i class="dot" aria-label="по умолчанию"></i>' : ""}</b><small>×${EFFORT_MULTIPLIERS[e]}</small></span>
      </label>`,
      )
      .join("")}</div>`;
    effortHint.textContent = state.effort
      ? `${state.effort}: ${EFFORT_HINTS[state.effort]}. По умолчанию у ${model.name} — ${model.defaultEffort} (отмечен точкой).`
      : "";
  }

  function renderOptions(): void {
    const model = getModel(state.modelId);
    cacheValue.textContent = `${state.cache}%`;
    batchInput.checked = state.batch;
    fastInput.checked = state.fast;
    batchInput.disabled = state.fast;
    fastInput.disabled = !model.fast || state.batch;

    const notes: string[] = [];
    if (!model.fast) notes.push(`Fast mode есть только у Opus 5.5, Opus 5 и Opus 4.8.`);
    else if (state.batch || state.fast) notes.push("Fast mode и Batch API несовместимы.");
    if (state.fast) notes.push(`Fast mode: ${formatPrice(model.fast!.input)} / ${formatPrice(model.fast!.output)} за 1M.`);
    optionsHint.textContent = notes.join(" ");
  }

  /** Токены задачи или текст ошибки ввода. */
  function currentTokens(): Tokens | string {
    if (state.size !== "custom") return SIZES[state.size];
    if (state.custom.input.trim() === "" || state.custom.output.trim() === "") {
      return "Укажите количество входных и выходных токенов.";
    }
    const input = Number(state.custom.input);
    const output = Number(state.custom.output);
    if (!Number.isFinite(input) || !Number.isFinite(output)) return "Введите числа.";
    return { input: Math.round(input), output: Math.round(output) };
  }

  function currentOptions(): EstimateOptions | string {
    const runs = Number(state.runs);
    if (state.runs.trim() === "" || !Number.isInteger(runs) || runs < 1) {
      return "Количество запусков — целое число от 1.";
    }
    return { cacheHitRate: state.cache / 100, batch: state.batch, fast: state.fast, runs };
  }

  function renderResult(estimate: CostEstimate): void {
    const model = getModel(state.modelId);
    const multiplier = estimate.effort ? EFFORT_MULTIPLIERS[estimate.effort] : 1;
    const tags = [
      estimate.effort ? `effort ${estimate.effort} ×${multiplier}` : "без effort",
      state.cache > 0 ? `кэш ${state.cache}%` : "",
      state.batch ? "Batch −50%" : "",
      state.fast ? "Fast mode" : "",
    ].filter(Boolean);
    const perRun = estimate.cost.total / estimate.runs;

    result.innerHTML = `
      <p class="result-label">${estimate.runs > 1 ? `Стоимость ${formatTokens(estimate.runs)} запусков` : "Стоимость задачи"}</p>
      <p class="total">${formatUsd(estimate.cost.total)}</p>
      ${estimate.runs > 1 ? `<p class="per-run">${formatUsd(perRun)} за запуск</p>` : ""}
      <p class="result-sub">${model.name}</p>
      <ul class="tags">${tags.map((t) => `<li>${t}</li>`).join("")}</ul>

      <dl class="breakdown">
        <div>
          <dt>Вход</dt>
          <dd class="calc">${formatTokens(estimate.tokens.input)} ток. × ${formatPrice(estimate.prices.input)}/1M</dd>
          <dd class="sum">${formatUsd(estimate.cost.input)}</dd>
        </div>
        ${
          estimate.tokens.cachedInput > 0
            ? `<div>
          <dt>Вход из кэша</dt>
          <dd class="calc">${formatTokens(estimate.tokens.cachedInput)} ток. × ${formatPrice(estimate.prices.cachedInput)}/1M</dd>
          <dd class="sum">${formatUsd(estimate.cost.cachedInput)}</dd>
        </div>`
            : ""
        }
        <div>
          <dt>Выход</dt>
          <dd class="calc">${formatTokens(estimate.tokens.output)} ток.${multiplier !== 1 ? ` (effort ×${multiplier})` : ""} × ${formatPrice(estimate.prices.output)}/1M</dd>
          <dd class="sum">${formatUsd(estimate.cost.output)}</dd>
        </div>
      </dl>

      <p class="note">Множители effort — оценка, а не тариф Anthropic. Выход включает токены размышлений (thinking). Запись в кэш не учитывается.</p>
    `;
  }

  function renderCompare(tokens: Tokens, options: EstimateOptions): void {
    const rows = compareModels(state.effort ?? undefined, tokens, options);
    const max = Math.max(...rows.map((r) => r.estimate.cost.total));
    const selected = rows.find((r) => r.modelId === state.modelId)!.estimate.cost.total;
    const anyFallback = rows.some((r) => r.effortFallback && r.estimate.effort);

    compare.innerHTML = `
      <table class="compare-table">
        <thead>
          <tr><th scope="col">Модель</th><th scope="col">Стоимость</th><th scope="col" class="num">К выбранной</th></tr>
        </thead>
        <tbody>
          ${rows
            .map((r) => {
              const total = r.estimate.cost.total;
              const isSelected = r.modelId === state.modelId;
              const diff =
                isSelected ? "выбрана" : selected > 0 ? formatDiff(total / selected - 1) : "—";
              const meta = [
                r.estimate.effort ? `${r.estimate.effort}${r.effortFallback ? "*" : ""}` : "без effort",
                r.fastUnavailable ? "без fast" : "",
              ]
                .filter(Boolean)
                .join(" · ");
              return `
            <tr class="${isSelected ? "selected" : ""}">
              <td>
                <button type="button" class="model-btn" data-model="${r.modelId}" aria-pressed="${isSelected}">${r.estimate.model.replace(/^Claude /, "")}</button>
                <small>${meta}</small>
              </td>
              <td>
                <div class="bar-cell">
                  <span class="bar" style="--w: ${max > 0 ? (total / max) * 100 : 0}%"></span>
                  <span class="bar-value">${formatUsd(total)}</span>
                </div>
              </td>
              <td class="num diff">${diff}</td>
            </tr>`;
            })
            .join("")}
        </tbody>
      </table>
      ${anyFallback ? '<p class="hint">* Модель не поддерживает выбранный effort — взят её effort по умолчанию.</p>' : ""}
    `;
  }

  function render(): void {
    const tokens = currentTokens();
    const options = currentOptions();
    const error = typeof tokens === "string" ? tokens : typeof options === "string" ? options : null;
    if (error) {
      result.innerHTML = `<p class="error">${error}</p>`;
      compare.innerHTML = "";
      return;
    }
    try {
      const t = tokens as Tokens;
      const o = options as EstimateOptions;
      renderResult(estimateCost({ modelId: state.modelId, effort: state.effort ?? undefined, size: t, options: o }));
      renderCompare(t, o);
    } catch (err) {
      result.innerHTML = `<p class="error">${(err as Error).message}</p>`;
      compare.innerHTML = "";
    }
  }

  form.addEventListener("change", (event) => {
    const target = event.target as HTMLInputElement | HTMLSelectElement;
    switch (target.name) {
      case "model":
        setModel(target.value);
        break;
      case "effort":
        state.effort = target.value as Effort;
        renderEffort();
        break;
      case "size":
        state.size = target.value as SizeChoice;
        customBox.hidden = state.size !== "custom";
        break;
      case "batch":
      case "fast":
        state[target.name] = (target as HTMLInputElement).checked;
        renderOptions();
        break;
      default:
        return;
    }
    render();
  });

  form.addEventListener("input", (event) => {
    const target = event.target as HTMLInputElement;
    if (target.name === "customInput") state.custom.input = target.value;
    else if (target.name === "customOutput") state.custom.output = target.value;
    else if (target.name === "runs") state.runs = target.value;
    else if (target.name === "cache") {
      state.cache = Number(target.value);
      renderOptions();
    } else return;
    render();
  });

  compare.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-model]");
    if (!button) return;
    setModel(button.dataset.model!);
    render();
  });

  renderEffort();
  renderOptions();
  render();
}

/** +150% / −40% относительно выбранной модели. */
function formatDiff(ratio: number): string {
  const pct = Math.round(ratio * 100);
  if (pct === 0) return "≈";
  return `${pct > 0 ? "+" : "−"}${Math.abs(pct)}%`;
}
