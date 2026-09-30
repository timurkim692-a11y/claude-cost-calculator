import {
  EFFORT_MULTIPLIERS,
  MODELS,
  SIZES,
  estimateCost,
  getModel,
  type Effort,
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
            <div class="custom" id="custom" hidden>
              <label>Вход, токенов
                <input type="number" name="customInput" min="0" step="1000" inputmode="numeric" />
              </label>
              <label>Выход, токенов
                <input type="number" name="customOutput" min="0" step="1000" inputmode="numeric" />
              </label>
            </div>
            <p class="hint">Выход указан для effort high; другие уровни effort его масштабируют.</p>
          </fieldset>
        </form>

        <section class="card result" id="result" aria-live="polite"></section>
      </div>
    </main>
  `;

  const form = root.querySelector<HTMLFormElement>("#form")!;
  const modelSelect = form.querySelector<HTMLSelectElement>("#model")!;
  const effortBox = form.querySelector<HTMLDivElement>("#effort")!;
  const effortHint = form.querySelector<HTMLParagraphElement>("#effort-hint")!;
  const customBox = form.querySelector<HTMLDivElement>("#custom")!;
  const customInput = form.querySelector<HTMLInputElement>('[name="customInput"]')!;
  const customOutput = form.querySelector<HTMLInputElement>('[name="customOutput"]')!;
  const result = root.querySelector<HTMLElement>("#result")!;

  modelSelect.value = state.modelId;
  form.querySelector<HTMLInputElement>(`[name="size"][value="${state.size}"]`)!.checked = true;
  customInput.value = state.custom.input;
  customOutput.value = state.custom.output;

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

  function currentTokens(): Tokens | string {
    if (state.size !== "custom") return SIZES[state.size];
    const input = Number(state.custom.input);
    const output = Number(state.custom.output);
    if (state.custom.input.trim() === "" || state.custom.output.trim() === "") {
      return "Укажите количество входных и выходных токенов.";
    }
    if (!Number.isFinite(input) || !Number.isFinite(output)) return "Введите числа.";
    return { input: Math.round(input), output: Math.round(output) };
  }

  function renderResult(): void {
    const tokens = currentTokens();
    if (typeof tokens === "string") {
      result.innerHTML = `<p class="error">${tokens}</p>`;
      return;
    }
    let estimate;
    try {
      estimate = estimateCost({
        modelId: state.modelId,
        effort: state.effort ?? undefined,
        size: tokens,
      });
    } catch (err) {
      result.innerHTML = `<p class="error">${(err as Error).message}</p>`;
      return;
    }
    const model = getModel(state.modelId);
    const multiplier = estimate.effort ? EFFORT_MULTIPLIERS[estimate.effort] : 1;
    const effortNote = estimate.effort
      ? `effort ${estimate.effort} ×${multiplier}`
      : "без effort";

    result.innerHTML = `
      <p class="result-label">Стоимость задачи</p>
      <p class="total">${formatUsd(estimate.cost.total)}</p>
      <p class="result-sub">${model.name} · ${effortNote}</p>

      <dl class="breakdown">
        <div>
          <dt>Вход</dt>
          <dd class="calc">${formatTokens(estimate.tokens.input)} ток. × ${formatPrice(model.input)}/1M</dd>
          <dd class="sum">${formatUsd(estimate.cost.input)}</dd>
        </div>
        <div>
          <dt>Выход</dt>
          <dd class="calc">${formatTokens(tokens.output)} × ${multiplier} = ${formatTokens(estimate.tokens.output)} ток. × ${formatPrice(model.output)}/1M</dd>
          <dd class="sum">${formatUsd(estimate.cost.output)}</dd>
        </div>
      </dl>

      <p class="note">Множители effort — оценка, а не тариф Anthropic. Выход включает токены размышлений (thinking).</p>
    `;
  }

  form.addEventListener("change", (event) => {
    const target = event.target as HTMLInputElement | HTMLSelectElement;
    if (target.name === "model") {
      state.modelId = target.value;
      const model = getModel(state.modelId);
      // Выбранный effort сохраняем, если новая модель его поддерживает.
      if (!state.effort || !model.efforts.includes(state.effort)) state.effort = model.defaultEffort;
      if (model.efforts.length === 0) state.effort = null;
      renderEffort();
    } else if (target.name === "effort") {
      state.effort = target.value as Effort;
      renderEffort();
    } else if (target.name === "size") {
      state.size = target.value as SizeChoice;
      customBox.hidden = state.size !== "custom";
    }
    renderResult();
  });

  form.addEventListener("input", (event) => {
    const target = event.target as HTMLInputElement;
    if (target.name === "customInput") state.custom.input = target.value;
    else if (target.name === "customOutput") state.custom.output = target.value;
    else return;
    renderResult();
  });

  renderEffort();
  renderResult();
}
