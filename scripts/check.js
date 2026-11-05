// Проверка сборки: проект без бандлера, поэтому «сборка» = синтаксис всех JS-файлов + тесты (npm run build).
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOTS = ['api', 'src', 'scripts', 'public', 'test'];

function jsFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return jsFiles(path);
    return path.endsWith('.js') ? [path] : [];
  });
}

const files = ROOTS.filter((root) => existsSync(root)).flatMap(jsFiles); // на Vercel тестов нет (.vercelignore)
const broken = files.filter((file) => spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' }).status !== 0);
if (broken.length > 0) {
  process.stderr.write(`Синтаксические ошибки в ${broken.length} файл(ах): ${broken.join(', ')}\n`);
  process.exit(1);
}
process.stdout.write(`Синтаксис в порядке: ${files.length} файлов.\n`);
