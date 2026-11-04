// Хелперы для чтения inline-клавиатур в тестах бота.
const rows = (markup) => markup?.inline_keyboard ?? [];

export const keyboardLabels = (markup) => rows(markup).flat().map((b) => b.text);

/** callback_data всех кнопок клавиатуры, подходящие под шаблон. */
export const tapped = (markup, pattern) =>
  rows(markup).flat().map((b) => b.callback_data).filter((d) => d && pattern.test(d));
