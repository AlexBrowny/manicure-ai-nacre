// Общее для экранов бота: показ сообщения и работа с черновиком записи.
import { HTML } from '../notifications.js';
import { getDraft, saveDraft } from '../store.js';

const isNotModified = (err) => String(err?.description ?? err?.message).includes('message is not modified');

/** Редактирует сообщение с кнопкой, а для обычных сообщений отправляет новое. */
export async function show(ctx, text, keyboard) {
  const options = { ...HTML, reply_markup: keyboard };
  if (ctx.callbackQuery?.message) {
    try {
      await ctx.editMessageText(text, options);
      return;
    } catch (err) {
      if (isNotModified(err)) return;
    }
  }
  await ctx.reply(text, options);
}

export function draftHelpers(db) {
  const draftOf = (ctx) => getDraft(db, ctx.chat.id);
  const patchDraft = async (ctx, patch) => saveDraft(db, ctx.chat.id, { ...((await draftOf(ctx)) ?? {}), ...patch });
  return { draftOf, patchDraft };
}

export { HTML };
