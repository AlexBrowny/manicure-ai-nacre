// Подборка роликов YouTube о маникюре для фона hero. Все проверены на возможность встраивания (oEmbed 200).
// `duration` — длина в секундах: по ней выбирается случайный отрезок без заставки и финальных титров.
// Ролики чужие и могут исчезнуть или закрыть встраивание — плеер сам переключится на другой (см. hero-video.js).
export const HERO_VIDEOS = [
  { id: 'tlVK8ZG10es', duration: 1122, note: '20 Nails — нейл-арт, подборка' },
  { id: 'VM4pW9abaIc', duration: 2038, note: '20 Nails — нейл-арт, подборка' },
  { id: 'KyrEOKrrKRg', duration: 870, note: '20 Nails — 3D-дизайн' },
  { id: 'CGAQ5WF94L4', duration: 1202, note: '20 Nails — fashion nail art' },
  { id: 'qZinUQl0Qo4', duration: 862, note: '20 Nails — пастельный нейл-арт' },
  { id: 'gbatMf6j_Ao', duration: 1069, note: 'Nat de Nail — 5 дизайнов' },
  { id: 'lsqj7oMb4N8', duration: 659, note: 'Nat de Nail — пастельные идеи' },
  { id: 'TFN1Hrq0Uxk', duration: 2160, note: 'Nails With Mandy — гель-ногти, без слов' },
  { id: 'P7WCtdPc29U', duration: 673, note: 'Vikki Swan — русский маникюр, процесс' },
  { id: '7A2fH1YYRbA', duration: 102, note: 'Пастельно-сиреневые ногти' },
  { id: '-uhSdC8HJl4', duration: 83, note: 'Сиреневый нейл-арт, сердечки' },
];

/**
 * Случайный ролик, не входящий в `exclude` (последний показанный и уже неудавшиеся).
 * Если исключены все — берём из полного списка.
 */
export function pickVideo(videos, { exclude = [], random = Math.random } = {}) {
  const pool = videos.filter((video) => !exclude.includes(video.id));
  const list = pool.length > 0 ? pool : videos;
  return list[Math.min(list.length - 1, Math.floor(random() * list.length))];
}

/**
 * Случайный отрезок ролика, который будет крутиться по кругу: пропускаем заставку в начале
 * и титры («Thanks for support…») в конце, у каждого обновления страницы кадры разные.
 * Короткие ролики берём целиком.
 * @returns {{ start: number, end: number }} секунды
 */
export function pickSegment(duration, { random = Math.random, length = 75, intro = 8, outro = 60 } = {}) {
  if (duration <= length + intro + outro) return { start: 0, end: duration };
  const room = duration - intro - outro - length;
  const start = Math.floor(intro + random() * room);
  return { start, end: start + length };
}
