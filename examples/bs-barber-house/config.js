'use strict';

// Dados da barbearia. Altere aqui serviços, preços, durações e horários.
module.exports = {
  name: 'BS Barber House',
  phone: '5542999968794', // WhatsApp do barbeiro (55 + DDD + número)
  phoneDisplay: '(42) 99996-8794',
  address: 'Rua Santa Cruz, 1023 – Jardim das Nações',
  city: 'Castro – PR',
  instagram: 'bs_barberhouse',
  timezone: 'America/Sao_Paulo',
  hours: {
    open: '09:00',
    close: '19:15',
    days: [1, 2, 3, 4, 5, 6], // 0 = domingo ... 6 = sábado
    label: 'Segunda a sábado, das 9h às 19h15',
  },
  slotStep: 30, // intervalo (min) entre os horários oferecidos ao cliente
  bookingWindowDays: 30, // quantos dias à frente o cliente pode agendar
  // duration em minutos
  services: [
    { id: 'cabelo', name: 'Cabelo', price: 40, duration: 30, desc: 'Degradê, social ou na tesoura, com acabamento na navalha.' },
    { id: 'barba', name: 'Barba', price: 40, duration: 30, desc: 'Barba alinhada e desenhada na navalha.' },
    { id: 'cabelo-barba', name: 'Cabelo e Barba', price: 80, duration: 60, desc: 'O combo clássico: corte + barba completos.' },
    { id: 'cabelo-sobrancelha', name: 'Cabelo + Sobrancelha', price: 50, duration: 45, desc: 'Corte com sobrancelha alinhada.' },
    { id: 'barba-sobrancelha', name: 'Barba + Sobrancelha', price: 50, duration: 45, desc: 'Barba feita com sobrancelha alinhada.' },
    { id: 'completo', name: 'Cabelo e Barba + Sobrancelha', price: 90, duration: 75, desc: 'O pacote completo para sair impecável.', featured: true },
    { id: 'limpeza-pele', name: 'Limpeza de Pele', price: 30, duration: 30, desc: 'Limpeza facial para uma pele renovada.' },
    { id: 'hidratacao', name: 'Hidratação Capilar', price: 40, duration: 30, desc: 'Tratamento para fios macios e saudáveis.' },
    { id: 'selagem', name: 'Desondulação (Selagem)', price: 100, duration: 90, desc: 'Alinhamento dos fios com redução de volume.' },
  ],
};
