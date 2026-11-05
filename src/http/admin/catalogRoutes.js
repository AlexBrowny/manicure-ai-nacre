// Мастера и услуги в админке.
import express from 'express';
import {
  createMaster, createService, deleteMaster, deleteService, getMaster, listMasters, listServices,
  updateMaster, updateService,
} from '../../domain/catalog.js';
import { removeMasterPhoto, setMasterPhoto, MAX_PHOTO_BYTES } from '../../domain/photos.js';
import { badRequest } from '../../errors.js';
import { adminMasterDto, serviceDto } from '../dto.js';
import { ok } from '../respond.js';
import { idParam, masterBody, serviceBody } from '../schemas.js';

async function assertServicesExist(ctx, ids) {
  const known = new Set((await listServices(ctx)).map((s) => s.id));
  if (ids.some((id) => !known.has(id))) throw badRequest('Выбрана несуществующая услуга');
}

export function adminCatalogRoutes({ ctx }) {
  const router = express.Router();
  const idOf = (req) => idParam.parse(req.params).id;

  router.get('/services', async (req, res) => res.json(ok((await listServices(ctx)).map(serviceDto))));

  router.post('/services', async (req, res) => {
    res.status(201).json(ok(serviceDto(await createService(ctx, serviceBody.parse(req.body)))));
  });

  router.put('/services/:id', async (req, res) => {
    res.json(ok(serviceDto(await updateService(ctx, idOf(req), serviceBody.parse(req.body)))));
  });

  router.delete('/services/:id', async (req, res) => {
    await deleteService(ctx, idOf(req));
    res.json(ok());
  });

  router.get('/masters', async (req, res) => res.json(ok((await listMasters(ctx)).map(adminMasterDto))));

  router.get('/masters/:id', async (req, res) => res.json(ok(adminMasterDto(await getMaster(ctx, idOf(req))))));

  router.post('/masters', async (req, res) => {
    const data = masterBody.parse(req.body);
    await assertServicesExist(ctx, data.serviceIds);
    res.status(201).json(ok(adminMasterDto(await createMaster(ctx, data))));
  });

  router.put('/masters/:id', async (req, res) => {
    const id = idOf(req);
    const data = masterBody.parse(req.body);
    await assertServicesExist(ctx, data.serviceIds);
    res.json(ok(adminMasterDto(await updateMaster(ctx, id, data))));
  });

  router.delete('/masters/:id', async (req, res) => {
    await deleteMaster(ctx, idOf(req));
    res.json(ok());
  });

  // Фото мастера — сырые байты картинки в теле запроса; тип проверяется по содержимому.
  const rawImage = express.raw({ type: ['image/*', 'application/octet-stream'], limit: MAX_PHOTO_BYTES });
  router.put('/masters/:id/photo', rawImage, async (req, res) => {
    const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    res.json(ok(adminMasterDto(await setMasterPhoto(ctx, idOf(req), bytes))));
  });

  router.delete('/masters/:id/photo', async (req, res) => {
    res.json(ok(adminMasterDto(await removeMasterPhoto(ctx, idOf(req)))));
  });

  return router;
}
