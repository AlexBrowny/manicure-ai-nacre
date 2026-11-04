// Минимальный логгер: строки с временем в stdout/stderr.
const stamp = () => new Date().toISOString();
const format = (parts) => parts.map((p) => (p instanceof Error ? (p.stack ?? p.message) : String(p))).join(' ');

export const logger = {
  info: (...parts) => process.stdout.write(`${stamp()} INFO  ${format(parts)}\n`),
  warn: (...parts) => process.stderr.write(`${stamp()} WARN  ${format(parts)}\n`),
  error: (...parts) => process.stderr.write(`${stamp()} ERROR ${format(parts)}\n`),
};
