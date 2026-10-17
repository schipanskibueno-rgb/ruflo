'use strict';

const config = require('../config');

// Status que ocupam a agenda.
const ACTIVE = new Set(['agendado', 'concluido']);

const toMin = (t) => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};
const toHHMM = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/** Data e minuto atuais no fuso da barbearia. */
function nowLocal() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: config.timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date());
  const get = (type) => parts.find((p) => p.type === type).value;
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    minutes: Number(get('hour')) * 60 + Number(get('minute')),
  };
}

function weekday(date) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function addDays(date, n) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

const isOpenDay = (date) => config.hours.days.includes(weekday(date));
const overlaps = (aStart, aEnd, bStart, bEnd) => aStart < bEnd && bStart < aEnd;

function busyIntervals(db, date, excludeId) {
  const busy = [];
  for (const b of db.bookings) {
    if (b.date !== date || !ACTIVE.has(b.status) || b.id === excludeId) continue;
    const start = toMin(b.time);
    busy.push([start, start + b.duration]);
  }
  for (const bl of db.blocks) {
    if (bl.date === date) busy.push([toMin(bl.start), toMin(bl.end)]);
  }
  return busy;
}

/** Horários livres (na grade de slotStep) para um serviço de `duration` minutos. */
function freeSlots(db, date, duration, { excludeId, includePast = false } = {}) {
  if (!isOpenDay(date)) return [];
  const now = nowLocal();
  if (!includePast && date < now.date) return [];
  const open = toMin(config.hours.open);
  const close = toMin(config.hours.close);
  const busy = busyIntervals(db, date, excludeId);
  const slots = [];
  for (let start = open; start + duration <= close; start += config.slotStep) {
    if (!includePast && date === now.date && start <= now.minutes) continue;
    if (busy.some(([a, b]) => overlaps(start, start + duration, a, b))) continue;
    slots.push(toHHMM(start));
  }
  return slots;
}

/** Validação usada pelo painel (aceita horários fora da grade). Retorna mensagem de erro ou null. */
function placementError(db, date, time, duration, excludeId) {
  const start = toMin(time);
  const end = start + duration;
  if (!isOpenDay(date)) return 'A barbearia não abre neste dia.';
  if (start < toMin(config.hours.open) || end > toMin(config.hours.close)) {
    return `Fora do horário de funcionamento (${config.hours.open} às ${config.hours.close}).`;
  }
  if (busyIntervals(db, date, excludeId).some(([a, b]) => overlaps(start, end, a, b))) {
    return 'Esse horário conflita com outro agendamento ou bloqueio.';
  }
  return null;
}

module.exports = {
  ACTIVE, toMin, toHHMM, nowLocal, weekday, addDays, isOpenDay, overlaps, freeSlots, placementError,
};
