// Neon Function: раз в минуту (триггер в neon.ts) просит сайт на Vercel разослать напоминания клиентам.
// Бесплатный Vercel запускает cron только раз в день, а напоминание «за 10 минут» требует ежеминутной проверки.
export default async function remindersCron(): Promise<Response> {
  const appUrl = process.env.APP_URL;
  const secret = process.env.CRON_SECRET;
  if (!appUrl || !secret) return new Response("APP_URL или CRON_SECRET не заданы", { status: 500 });

  const res = await fetch(`${appUrl.replace(/\/+$/, "")}/api/cron/reminders`, {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}` },
  });
  return new Response(await res.text(), {
    status: res.status,
    headers: { "Content-Type": "application/json" },
  });
}
