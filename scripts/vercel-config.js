// Пишет vercel.json: маршруты в функцию api/index.js и заголовки безопасности для статики (те же, что ставит Express).
// npm run vercel:config — после изменения CSP в src/http/app.js. Тест следит, чтобы файл не отставал.
import { writeFileSync } from 'node:fs';
import { CSP, MINIAPP_CSP } from '../src/http/app.js';

const security = (csp) => [
  { key: 'Content-Security-Policy', value: csp },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

export const vercelConfig = {
  $schema: 'https://openapi.vercel.sh/vercel.json',
  framework: null,
  buildCommand: 'node scripts/check.js',
  outputDirectory: 'public',
  rewrites: [
    { source: '/api/:path*', destination: '/api' },
    { source: '/media/:path*', destination: '/api' },
    { source: '/telegram/:path*', destination: '/api' },
  ],
  headers: [
    { source: '/(.*)', headers: security(CSP) },
    { source: '/app/(.*)', headers: security(MINIAPP_CSP) },
    { source: '/app', headers: security(MINIAPP_CSP) },
  ],
};

if (process.argv[1]?.endsWith('vercel-config.js')) {
  writeFileSync(new URL('../vercel.json', import.meta.url), `${JSON.stringify(vercelConfig, null, 2)}\n`);
  process.stdout.write('vercel.json обновлён\n');
}
