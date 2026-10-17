'use strict';

const fs = require('fs');
const path = require('path');
const config = require('../config');
const store = require('./store');
const sch = require('./schedule');

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const STATUSES = ['agendado', 'concluido', 'cancelado', 'faltou'];

function isValidDate(d) {
  if (typeof d !== 'string' || !DATE_RE.test(d)) return false;
  const [y, m, day] = d.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, day));
  return dt.getUTCMonth() === m - 1 && dt.getUTCDate() === day;
}
const isValidTime = (t) => typeof t === 'string' && TIME_RE.test(t);
const cleanText = (s, max) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const findService = (id) => config.services.find((s) => s.id === id);

function requireDate(d) {
  if (!isValidDate(d)) throw new HttpError(400, 'Data inválida.');
  return d;
}

function requireTime(t) {
  if (!isValidTime(t)) throw new HttpError(400, 'Horário inválido.');
  return t;
}

function requireService(id) {
  const service = findService(id);
  if (!service) throw new HttpError(400, 'Serviço inválido.');
  return service;
}

// ---------------------------------------------------------------- bookings

function createBooking(input, { admin = false } = {}) {
  const service = requireService(input.serviceId);
  const date = requireDate(input.date);
  const time = requireTime(input.time);
  const name = cleanText(input.name, 60);
  if (name.length < 2) throw new HttpError(400, 'Informe seu nome.');
  const phone = String(input.phone ?? '').replace(/\D/g, '');
  if (phone.length < 10 || phone.length > 13) throw new HttpError(400, 'Informe um telefone/WhatsApp válido com DDD.');
  const notes = cleanText(input.notes, 200);
  const db = store.db;

  if (admin) {
    const err = sch.placementError(db, date, time, service.duration);
    if (err) throw new HttpError(409, err);
  } else {
    const today = sch.nowLocal().date;
    if (date > sch.addDays(today, config.bookingWindowDays)) {
      throw new HttpError(400, `Agendamentos são liberados para os próximos ${config.bookingWindowDays} dias.`);
    }
    if (!sch.freeSlots(db, date, service.duration).includes(time)) {
      throw new HttpError(409, 'Esse horário acabou de ser ocupado. Por favor, escolha outro.');
    }
  }

  const booking = {
    id: store.newId(),
    code: store.newCode(),
    serviceId: service.id,
    serviceName: service.name,
    price: service.price,
    duration: service.duration,
    date,
    time,
    name,
    phone,
    notes,
    status: 'agendado',
    source: admin ? 'painel' : 'site',
    createdAt: new Date().toISOString(),
    history: [],
  };
  db.bookings.push(booking);
  store.save();
  return booking;
}

function updateBooking(id, patch) {
  const db = store.db;
  const booking = db.bookings.find((b) => b.id === id);
  if (!booking) throw new HttpError(404, 'Agendamento não encontrado.');
  const at = new Date().toISOString();

  if (patch.date !== undefined || patch.time !== undefined) {
    const date = requireDate(patch.date);
    const time = requireTime(patch.time);
    const err = sch.placementError(db, date, time, booking.duration, booking.id);
    if (err) throw new HttpError(409, err);
    booking.history.push({ at, action: 'remarcado', from: `${booking.date} ${booking.time}`, to: `${date} ${time}` });
    booking.date = date;
    booking.time = time;
    booking.status = 'agendado';
  }

  if (patch.status !== undefined) {
    if (!STATUSES.includes(patch.status)) throw new HttpError(400, 'Status inválido.');
    if (patch.status === 'agendado' && booking.status !== 'agendado') {
      const err = sch.placementError(db, booking.date, booking.time, booking.duration, booking.id);
      if (err) throw new HttpError(409, err);
    }
    if (patch.status !== booking.status) {
      booking.history.push({ at, action: patch.status, from: booking.status });
      booking.status = patch.status;
    }
  }

  if (patch.notes !== undefined) booking.notes = cleanText(patch.notes, 200);
  if (patch.price !== undefined) {
    const price = Number(patch.price);
    if (!Number.isFinite(price) || price < 0 || price > 10000) throw new HttpError(400, 'Valor inválido.');
    booking.price = Math.round(price * 100) / 100;
  }

  store.save();
  return booking;
}

function listBookings({ from, to } = {}) {
  return store.db.bookings
    .filter((b) => (!from || b.date >= from) && (!to || b.date <= to))
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
}

// ------------------------------------------------------------------ blocks

function createBlock(input) {
  const date = requireDate(input.date);
  const allDay = Boolean(input.allDay);
  const start = allDay ? config.hours.open : requireTime(input.start);
  const end = allDay ? config.hours.close : requireTime(input.end);
  if (sch.toMin(end) <= sch.toMin(start)) throw new HttpError(400, 'O horário final deve ser depois do inicial.');
  const block = { id: store.newId(), date, start, end, allDay, reason: cleanText(input.reason, 80) };
  const conflicts = store.db.bookings.filter((b) => b.date === date && b.status === 'agendado'
    && sch.overlaps(sch.toMin(b.time), sch.toMin(b.time) + b.duration, sch.toMin(start), sch.toMin(end))).length;
  store.db.blocks.push(block);
  store.save();
  return { block, conflicts };
}

function deleteBlock(id) {
  const before = store.db.blocks.length;
  store.db.blocks = store.db.blocks.filter((b) => b.id !== id);
  if (store.db.blocks.length === before) throw new HttpError(404, 'Bloqueio não encontrado.');
  store.save();
}

// ----------------------------------------------------------------- gallery

const IMAGE_TYPES = {
  jpeg: { ext: 'jpg', magic: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  png: { ext: 'png', magic: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  webp: { ext: 'webp', magic: (b) => b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP' },
};
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

function addPhoto(input) {
  const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(input.image || ''));
  if (!match) throw new HttpError(400, 'Envie uma imagem JPG, PNG ou WEBP.');
  const type = IMAGE_TYPES[match[1]];
  const buf = Buffer.from(match[2], 'base64');
  if (buf.length > MAX_IMAGE_BYTES) throw new HttpError(413, 'Imagem muito grande (máx. 4 MB).');
  if (!type.magic(buf)) throw new HttpError(400, 'Arquivo de imagem inválido.');
  const id = store.newId();
  const file = `${id}.${type.ext}`;
  fs.writeFileSync(path.join(store.UPLOAD_DIR, file), buf);
  const photo = { id, file, caption: cleanText(input.caption, 60), createdAt: new Date().toISOString() };
  store.db.gallery.unshift(photo);
  store.save();
  return photo;
}

function deletePhoto(id) {
  const photo = store.db.gallery.find((p) => p.id === id);
  if (!photo) throw new HttpError(404, 'Foto não encontrada.');
  store.db.gallery = store.db.gallery.filter((p) => p.id !== id);
  store.save();
  fs.rm(path.join(store.UPLOAD_DIR, photo.file), { force: true }, () => {});
}

module.exports = {
  HttpError, isValidDate, requireDate, findService, requireService,
  createBooking, updateBooking, listBookings, createBlock, deleteBlock, addPhoto, deletePhoto,
};
