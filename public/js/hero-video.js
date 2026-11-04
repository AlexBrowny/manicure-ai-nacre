// Фоновое видео hero: случайный ролик о маникюре с YouTube — без звука, по кругу, без интерфейса плеера.
import { HERO_VIDEOS, pickSegment, pickVideo } from './hero-playlist.js';

const API_SRC = 'https://www.youtube.com/iframe_api';
const EMBED_HOST = 'https://www.youtube-nocookie.com'; // режим без cookie до начала воспроизведения
const PLAY_TIMEOUT_MS = 9000;
const MAX_ATTEMPTS = 3;
const LAST_KEY = 'nacre:lastHeroVideo';

let apiPromise;
function loadYouTubeApi() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  apiPromise ??= new Promise((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      resolve(window.YT);
    };
    const script = document.createElement('script');
    script.src = API_SRC;
    script.async = true;
    script.onerror = () => reject(new Error('YouTube недоступен'));
    document.head.append(script);
  });
  return apiPromise;
}

// sessionStorage может быть недоступен (приватный режим) — это лишь удобство, поэтому всё в try/catch.
function lastVideoId() {
  try { return sessionStorage.getItem(LAST_KEY); } catch { return null; }
}
function rememberVideo(id) {
  try { sessionStorage.setItem(LAST_KEY, id); } catch { /* не критично */ }
}

function canAutoplay() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
  return !navigator.connection?.saveData;
}

/** Создаёт плеер и ждёт, пока видео реально пойдёт. true — играет, false — ошибка/таймаут. */
function mountPlayer(YT, mount, videoId, segment) {
  return new Promise((resolve) => {
    const slot = document.createElement('div');
    mount.replaceChildren(slot);
    let settled = false;
    let player = null;
    let timer = 0;

    const finish = (ok) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (!ok) {
        try { player?.destroy(); } catch { /* уже уничтожен */ }
        mount.replaceChildren();
      }
      resolve(ok);
    };
    // Во вкладке на заднем плане автозапуск приостановлен — таймер считаем только пока она видима.
    const arm = () => {
      timer = setTimeout(() => (document.hidden ? arm() : finish(false)), PLAY_TIMEOUT_MS);
    };
    arm();

    player = new YT.Player(slot, {
      host: EMBED_HOST,
      videoId,
      width: '100%',
      height: '100%',
      playerVars: {
        autoplay: 1, mute: 1, controls: 0, disablekb: 1, fs: 0, rel: 0, modestbranding: 1,
        iv_load_policy: 3, cc_load_policy: 0, playsinline: 1,
        start: segment.start,
        ...(segment.end ? { end: segment.end } : {}),
        origin: window.location.origin,
      },
      events: {
        onReady: (event) => { event.target.mute(); event.target.playVideo(); },
        onStateChange: (event) => {
          if (event.data === YT.PlayerState.PLAYING) finish(true);
          else if (event.data === YT.PlayerState.ENDED) { // конец отрезка — начинаем снова
            event.target.seekTo(segment.start, true);
            event.target.playVideo();
          }
        },
        onError: () => finish(false),
      },
    });
  });
}

/**
 * Запускает случайный ролик в контейнере `mount`.
 * @returns {Promise<boolean>} true — видео играет; false — используем запасное фото.
 */
export async function startHeroVideo({ mount, videos = HERO_VIDEOS }) {
  if (!mount || !canAutoplay()) return false;
  let YT;
  try {
    YT = await loadYouTubeApi();
  } catch {
    return false;
  }

  const tried = [lastVideoId()].filter(Boolean); // «новое» видео после обновления страницы
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const video = pickVideo(videos, { exclude: tried });
    tried.push(video.id);
    const segment = pickSegment(video.duration);
    if (await mountPlayer(YT, mount, video.id, segment)) {
      rememberVideo(video.id);
      mount.classList.add('is-playing');
      return true;
    }
  }
  return false;
}
