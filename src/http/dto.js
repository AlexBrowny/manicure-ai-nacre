// Преобразование доменных объектов в JSON для клиентов (время — 'HH:MM').
import { minToHHMM } from '../time.js';

const hhmm = (min) => (min == null ? null : minToHHMM(min));

export function serviceDto(s) {
  return {
    id: s.id, name: s.name, category: s.category, description: s.description,
    durationMin: s.durationMin, price: s.price, active: s.active,
  };
}

export function publicMasterDto(m, nextSlot = undefined) {
  const dto = {
    id: m.id, name: m.name, title: m.title, bio: m.bio, color: m.color, photoUrl: m.photoUrl,
    serviceIds: m.serviceIds,
  };
  if (nextSlot !== undefined) dto.nextSlot = nextSlot && { date: nextSlot.date, time: hhmm(nextSlot.start) };
  return dto;
}

export function adminMasterDto(m) {
  return {
    id: m.id, name: m.name, title: m.title, bio: m.bio, color: m.color, photoUrl: m.photoUrl,
    active: m.active, serviceIds: m.serviceIds,
    schedule: m.schedule.map((d) => ({
      weekday: d.weekday, start: hhmm(d.startMin), end: hhmm(d.endMin),
      breakStart: hhmm(d.breakStartMin), breakEnd: hhmm(d.breakEndMin),
    })),
    daysOff: m.daysOff,
  };
}

export function bookingDto(b) {
  return {
    id: b.id, masterId: b.masterId, masterName: b.masterName, masterColor: b.masterColor,
    serviceId: b.serviceId, serviceName: b.serviceName, price: b.price, date: b.date,
    startMin: b.startMin, endMin: b.endMin, start: hhmm(b.startMin), end: hhmm(b.endMin),
    clientName: b.clientName, clientPhone: b.clientPhone, source: b.source, status: b.status,
    telegram: b.tgChatId != null, notes: b.notes, createdAt: b.createdAt,
  };
}

export const slotDto = (s) => ({ start: s.start, time: hhmm(s.start) });
