// Анимация успешной записи: флакон лака «красит» ноготь, вылетает конфетти из блёсток, капель лака и сердечек.
import { h, svg } from '/js/dom.js';
import { dateLong, money } from '/js/format.js';

const COLORS = ['#8e7cc3', '#f4b8a2', '#c77dae', '#f9d3c4', '#b9a6e0', '#ffffff', '#f0a58c'];
const REDUCED = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Ноготь с лаком, флакон с кисточкой, блик и галочка. Все движения — CSS-анимации в miniapp.css.
const NAIL_SCENE = `
<svg class="cel-scene" viewBox="0 0 220 200" aria-hidden="true">
  <defs>
    <linearGradient id="celPolish" x1="0" y1="1" x2="0" y2="0">
      <stop offset="0" stop-color="#8e7cc3"/><stop offset="0.6" stop-color="#c77dae"/><stop offset="1" stop-color="#f4b8a2"/>
    </linearGradient>
    <clipPath id="celNail"><path d="M70 170 V86 A40 40 0 0 1 150 86 V170 Q150 184 136 184 H84 Q70 184 70 170 Z"/></clipPath>
  </defs>
  <path class="cel-finger" d="M58 200 V96 A52 52 0 0 1 162 96 V200 Z"/>
  <path class="cel-nail-bare" d="M70 170 V86 A40 40 0 0 1 150 86 V170 Q150 184 136 184 H84 Q70 184 70 170 Z"/>
  <g clip-path="url(#celNail)">
    <rect class="cel-polish" x="70" y="46" width="80" height="140" fill="url(#celPolish)"/>
    <rect class="cel-gloss" x="82" y="40" width="14" height="150"/>
  </g>
  <g class="cel-bottle">
    <rect x="166" y="10" width="34" height="18" rx="4" fill="#3b2f5c"/>
    <rect x="160" y="28" width="46" height="50" rx="12" fill="url(#celPolish)" stroke="#fff" stroke-width="2"/>
    <rect x="181" y="78" width="4" height="34" rx="2" fill="#3b2f5c"/>
    <path d="M178 110 h10 l-2 12 h-6 z" fill="#c77dae"/>
  </g>
  <g class="cel-check">
    <circle cx="160" cy="154" r="22" fill="#3f9d7a" stroke="#fff" stroke-width="4"/>
    <path d="M149 155 l8 8 15-16" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
  <path class="cel-spark s1" d="M40 40c1 8 5 12 13 13-8 1-12 5-13 13-1-8-5-12-13-13 8-1 12-5 13-13z"/>
  <path class="cel-spark s2" d="M196 140c.8 6 3.5 8.6 9.5 9.5-6 .8-8.6 3.5-9.5 9.5-.8-6-3.5-8.6-9.5-9.5 6-.9 8.7-3.5 9.5-9.5z"/>
</svg>`;

// ---- Конфетти на canvas ----
function drawShape(c, p) {
  c.save();
  c.translate(p.x, p.y);
  c.rotate(p.angle);
  c.fillStyle = p.color;
  c.globalAlpha = p.alpha;
  const s = p.size;
  c.beginPath();
  if (p.shape === 'star') {
    c.moveTo(0, -s);
    c.quadraticCurveTo(s * 0.15, -s * 0.15, s, 0);
    c.quadraticCurveTo(s * 0.15, s * 0.15, 0, s);
    c.quadraticCurveTo(-s * 0.15, s * 0.15, -s, 0);
    c.quadraticCurveTo(-s * 0.15, -s * 0.15, 0, -s);
  } else if (p.shape === 'drop') { // капля лака
    c.moveTo(0, -s);
    c.bezierCurveTo(s * 0.9, -s * 0.1, s * 0.7, s, 0, s);
    c.bezierCurveTo(-s * 0.7, s, -s * 0.9, -s * 0.1, 0, -s);
  } else if (p.shape === 'heart') {
    c.moveTo(0, s * 0.35);
    c.bezierCurveTo(-s, -s * 0.3, -s * 0.4, -s, 0, -s * 0.35);
    c.bezierCurveTo(s * 0.4, -s, s, -s * 0.3, 0, s * 0.35);
  } else {
    c.ellipse(0, 0, s * 0.9, s * 0.45, 0, 0, Math.PI * 2); // «пайетка»
  }
  c.fill();
  c.restore();
}

function burst(particles, { x, y, count, angle, spread, power }) {
  const shapes = ['star', 'drop', 'heart', 'dot', 'star'];
  for (let i = 0; i < count; i += 1) {
    const a = angle + (Math.random() - 0.5) * spread;
    const v = power * (0.55 + Math.random() * 0.6);
    particles.push({
      x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
      size: 4 + Math.random() * 7, angle: Math.random() * Math.PI, spin: (Math.random() - 0.5) * 0.3,
      color: COLORS[Math.floor(Math.random() * COLORS.length)], shape: shapes[Math.floor(Math.random() * shapes.length)],
      alpha: 1, life: 0,
    });
  }
}

/** Три залпа: из центра и с двух сторон. Холст удаляется сам, когда всё упало. */
function confetti() {
  const canvas = h('canvas', { class: 'cel-confetti', 'aria-hidden': 'true' });
  document.body.append(canvas);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = window.innerWidth;
  const hgt = window.innerHeight;
  canvas.width = w * dpr;
  canvas.height = hgt * dpr;
  const c = canvas.getContext('2d');
  c.scale(dpr, dpr);

  const particles = [];
  burst(particles, { x: w / 2, y: hgt * 0.32, count: 90, angle: -Math.PI / 2, spread: Math.PI * 1.1, power: 13 });
  setTimeout(() => {
    burst(particles, { x: 0, y: hgt * 0.75, count: 45, angle: -Math.PI / 3, spread: 0.7, power: 16 });
    burst(particles, { x: w, y: hgt * 0.75, count: 45, angle: (-2 * Math.PI) / 3, spread: 0.7, power: 16 });
  }, 380);

  const started = performance.now();
  const frame = (now) => {
    c.clearRect(0, 0, w, hgt);
    for (const p of particles) {
      p.vx *= 0.985;
      p.vy = p.vy * 0.985 + 0.32; // гравитация
      p.x += p.vx;
      p.y += p.vy;
      p.angle += p.spin;
      p.life += 1;
      if (p.life > 110) p.alpha = Math.max(0, p.alpha - 0.02);
      drawShape(c, p);
    }
    const alive = particles.some((p) => p.alpha > 0 && p.y < hgt + 40);
    if (alive || now - started < 600) requestAnimationFrame(frame);
    else canvas.remove();
  };
  requestAnimationFrame(frame);
}

/**
 * @param {{ booking: object, config: object, reminders?: string, onAgain: () => void }} props
 * @returns {HTMLElement}
 */
export function celebrate({ booking, config, reminders, onAgain }) {
  const line = (label, value) => h('div', {}, h('span', {}, label), h('b', {}, value));
  const view = h('section', { class: 'panel cel' },
    svg(NAIL_SCENE),
    h('h2', { class: 'cel-title' }, 'Вы записаны! 💅'),
    h('p', { class: 'cel-sub' }, `${booking.clientName.split(' ')[0]}, ждём вас в ${config.studio.name}`),
    h('div', { class: 'done__card cel-card' },
      line('Услуга', booking.serviceName),
      line('Мастер', booking.masterName),
      line('Когда', `${dateLong(booking.date)}, ${booking.start}–${booking.end}`),
      line('Стоимость', money(booking.price, config.currency)),
      line('Адрес', config.studio.address)),
    h('p', { class: 'cel-note' }, `Напомним в этом чате ${reminders || 'перед визитом'}. Отменить запись можно в «Мои записи».`),
    h('button', { class: 'btn', type: 'button', onclick: onAgain }, 'Записаться ещё'));
  if (!REDUCED()) requestAnimationFrame(() => setTimeout(confetti, 1300)); // залп — когда ноготь докрашен
  return view;
}
