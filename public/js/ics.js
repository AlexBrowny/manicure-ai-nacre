// «Добавить в календарь»: формируем .ics прямо в браузере (время «плавающее» — в часовом поясе студии).
const escapeText = (text) => String(text).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const stamp = (date, time) => `${date.replace(/-/g, '')}T${time.replace(':', '')}00`;

export function buildIcs(booking, config) {
  const now = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Nacre//Booking//RU',
    'BEGIN:VEVENT',
    `UID:booking-${booking.id}@${window.location.hostname}`,
    `DTSTAMP:${now}`,
    `DTSTART:${stamp(booking.date, booking.start)}`,
    `DTEND:${stamp(booking.date, booking.end)}`,
    `SUMMARY:${escapeText(`${booking.serviceName} — ${config.studio.name}`)}`,
    `LOCATION:${escapeText(config.studio.address)}`,
    `DESCRIPTION:${escapeText(`Мастер: ${booking.masterName}\nТелефон студии: ${config.studio.phone}`)}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}

export function downloadIcs(booking, config) {
  const blob = new Blob([buildIcs(booking, config)], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `zapis-${booking.date}.ics`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
