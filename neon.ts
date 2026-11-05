import { defineConfig } from "@neon/config/v1";

export default defineConfig({
  // Declare your Neon services here
  preview: {
    realtime: true,
  },
  auth: true,
  functions: {
    hello: { name: "Hello World", source: "./hello.ts" },
    // Раз в минуту вызывает POST /api/cron/reminders на Vercel (APP_URL, CRON_SECRET — из .env: neon deploy --env .env)
    reminders: {
      name: "Reminders cron",
      source: "./reminders-cron.ts",
      env: { APP_URL: process.env.APP_URL!, CRON_SECRET: process.env.CRON_SECRET! },
    },
  },
  triggers: {
    "reminders-every-minute": {
      type: "schedule",
      function: "reminders",
      cron: "* * * * *",
    },
  },
  buckets: {
    // "private" is the default; use "public_read" for anonymous reads
    assets: { access: "private" },
  },
  // Branch policy: per-branch tuning
  branch: (branch) => {
    if (branch.isDefault) {
      // Default branch: no overrides, uses project defaults
      return {};
    }
    if (!branch.exists) {
      // New non-default branches: auto-expire
      // Run `neon checkout <name>` to create a new branch with these settings
      return { ttl: "7d" };
    }
    // Existing branch: no changes
    return {};
  },
});
