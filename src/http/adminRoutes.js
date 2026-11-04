// API админ-панели: вход открыт, остальное — только с сессией.
import express from 'express';
import { requireAdmin } from './auth.js';
import { adminAuthRoutes } from './admin/authRoutes.js';
import { adminBookingRoutes } from './admin/bookingRoutes.js';
import { adminCatalogRoutes } from './admin/catalogRoutes.js';

export function adminRoutes({ ctx, events, runtime = {} }) {
  const router = express.Router();
  router.use(adminAuthRoutes({ cfg: ctx.cfg }));
  router.use(requireAdmin(ctx.cfg));
  router.use(adminBookingRoutes({ ctx, events, runtime }));
  router.use(adminCatalogRoutes({ ctx }));
  return router;
}
