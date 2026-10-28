-- =============================================================================
-- Barbearia Machado — banco de dados do agendamento (Supabase)
--
-- Como usar: Supabase → SQL Editor → New query → cole este arquivo inteiro → Run.
-- Pode rodar de novo sem perder agendamentos (os cadastros de barbeiros,
-- serviços e horários são atualizados; as tabelas de dados são mantidas).
--
-- Quem pode o quê:
--   • Cliente (sem login): vê barbeiros, serviços, horários e quais intervalos
--     estão ocupados (sem nome nem telefone de ninguém) e cria agendamento.
--   • Dono (staff.role = 'admin'): vê e gerencia tudo.
--   • Barbeiro (staff.role = 'barber'): vê e gerencia só a própria agenda.
-- =============================================================================

create extension if not exists btree_gist;

-- ----------------------------------------------------------------- cadastros
create table if not exists public.barbers (
  id     text primary key,
  name   text not null,
  role   text not null default 'Barbeiro',
  owner  boolean not null default false,
  photo  text not null default '',
  bio    text not null default '',
  sort   int  not null default 0,
  active boolean not null default true
);

create table if not exists public.services (
  id          text primary key,
  cat         text not null,
  name        text not null,
  price       numeric(10, 2) not null check (price >= 0),
  duration    int  not null check (duration between 5 and 600),
  description text not null default '',
  tag         text,
  sort        int  not null default 0,
  active      boolean not null default true
);

-- Horário de funcionamento por dia da semana (0 = domingo). Dia sem linha = fechado.
create table if not exists public.business_hours (
  weekday    int  primary key check (weekday between 0 and 6),
  open_time  time not null,
  close_time time not null,
  check (close_time > open_time)
);

-- Quem acessa o painel: liga o usuário do Supabase Auth ao papel dele.
create table if not exists public.staff (
  user_id   uuid primary key references auth.users (id) on delete cascade,
  role      text not null check (role in ('admin', 'barber')),
  barber_id text references public.barbers (id),
  check (role = 'admin' or barber_id is not null)
);

-- ----------------------------------------------------------------- dados
create table if not exists public.bookings (
  id           uuid primary key default gen_random_uuid(),
  code         text not null unique,
  service_id   text not null references public.services (id),
  service_name text not null,
  price        numeric(10, 2) not null check (price >= 0),
  duration     int  not null check (duration > 0),
  barber_id    text not null references public.barbers (id),
  barber_name  text not null,
  date         date not null,
  time         time not null,
  name         text not null,
  phone        text not null,
  notes        text not null default '',
  status       text not null default 'agendado' check (status in ('agendado', 'concluido', 'cancelado', 'faltou')),
  source       text not null default 'site',
  history      jsonb not null default '[]',
  created_at   timestamptz not null default now(),
  span         tsrange generated always as (tsrange(date + time, date + time + make_interval(mins => duration))) stored,
  -- Trava no banco: o mesmo barbeiro nunca fica com dois horários sobrepostos.
  constraint bookings_no_overlap exclude using gist (barber_id with =, span with &&)
    where (status in ('agendado', 'concluido'))
);
create index if not exists bookings_date_idx on public.bookings (date);
create index if not exists bookings_phone_idx on public.bookings (phone);

create table if not exists public.blocks (
  id         uuid primary key default gen_random_uuid(),
  barber_id  text references public.barbers (id),  -- vazio (null) = barbearia toda
  date       date not null,
  start_time time not null,
  end_time   time not null,
  all_day    boolean not null default false,
  reason     text not null default '',
  created_at timestamptz not null default now(),
  check (end_time > start_time)
);
create index if not exists blocks_date_idx on public.blocks (date);

create table if not exists public.gallery (
  id         uuid primary key default gen_random_uuid(),
  image      text not null check (image ~ '^data:image/(jpeg|png|webp);base64,' and length(image) < 3000000),
  caption    text not null default '',
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------- quem é quem
create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from staff where user_id = auth.uid());
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from staff where user_id = auth.uid() and role = 'admin');
$$;

-- Barbeiro do usuário logado (null para o dono e para clientes).
create or replace function public.my_barber() returns text
language sql stable security definer set search_path = public as $$
  select barber_id from staff where user_id = auth.uid() and role = 'barber';
$$;

-- ----------------------------------------------------------------- regras de acesso (RLS)
alter table public.barbers        enable row level security;
alter table public.services       enable row level security;
alter table public.business_hours enable row level security;
alter table public.staff          enable row level security;
alter table public.bookings       enable row level security;
alter table public.blocks         enable row level security;
alter table public.gallery        enable row level security;

drop policy if exists "leitura publica" on public.barbers;
drop policy if exists "dono edita" on public.barbers;
create policy "leitura publica" on public.barbers for select using (true);
create policy "dono edita" on public.barbers for all to authenticated using (is_admin()) with check (is_admin());

drop policy if exists "leitura publica" on public.services;
drop policy if exists "dono edita" on public.services;
create policy "leitura publica" on public.services for select using (true);
create policy "dono edita" on public.services for all to authenticated using (is_admin()) with check (is_admin());

drop policy if exists "leitura publica" on public.business_hours;
drop policy if exists "dono edita" on public.business_hours;
create policy "leitura publica" on public.business_hours for select using (true);
create policy "dono edita" on public.business_hours for all to authenticated using (is_admin()) with check (is_admin());

drop policy if exists "ve o proprio cadastro" on public.staff;
create policy "ve o proprio cadastro" on public.staff for select to authenticated using (user_id = auth.uid() or is_admin());

-- Agendamentos: cliente não lê nada (cria pela função create_booking);
-- equipe lê pela tabela e altera pela função update_booking.
drop policy if exists "equipe le" on public.bookings;
create policy "equipe le" on public.bookings for select to authenticated
  using (is_admin() or barber_id = my_barber());

drop policy if exists "equipe le" on public.blocks;
drop policy if exists "equipe cria" on public.blocks;
drop policy if exists "equipe remove" on public.blocks;
create policy "equipe le" on public.blocks for select to authenticated using (is_staff());
create policy "equipe cria" on public.blocks for insert to authenticated
  with check (is_admin() or (barber_id is not null and barber_id = my_barber()));
create policy "equipe remove" on public.blocks for delete to authenticated
  using (is_admin() or (barber_id is not null and barber_id = my_barber()));

drop policy if exists "leitura publica" on public.gallery;
drop policy if exists "equipe envia" on public.gallery;
drop policy if exists "equipe remove" on public.gallery;
create policy "leitura publica" on public.gallery for select using (true);
create policy "equipe envia" on public.gallery for insert to authenticated with check (is_staff());
create policy "equipe remove" on public.gallery for delete to authenticated using (is_staff());

-- ----------------------------------------------------------------- funções da agenda
create or replace function public._minutes(t time) returns int
language sql immutable as $$ select (extract(epoch from t) / 60)::int $$;

create or replace function public._local_now() returns timestamp
language sql stable as $$ select now() at time zone 'America/Sao_Paulo' $$;

-- Motivo pelo qual o horário não cabe (ou null se cabe).
create or replace function public._placement_error(p_date date, p_time time, p_duration int, p_barber text, p_exclude uuid)
returns text language plpgsql stable security definer set search_path = public as $$
declare
  h business_hours;
  s int := _minutes(p_time);
  e int := _minutes(p_time) + p_duration;
begin
  select * into h from business_hours where weekday = extract(dow from p_date)::int;
  if not found then
    return 'A barbearia não abre neste dia.';
  end if;
  if s < _minutes(h.open_time) or e > _minutes(h.close_time) then
    return format('Fora do horário de funcionamento (%s às %s).', to_char(h.open_time, 'HH24:MI'), to_char(h.close_time, 'HH24:MI'));
  end if;
  if exists (
    select 1 from bookings b
    where b.date = p_date and b.barber_id = p_barber and b.status in ('agendado', 'concluido')
      and b.id is distinct from p_exclude
      and int4range(_minutes(b.time), _minutes(b.time) + b.duration) && int4range(s, e)
  ) or exists (
    select 1 from blocks bl
    where bl.date = p_date and (bl.barber_id is null or bl.barber_id = p_barber)
      and int4range(_minutes(bl.start_time), _minutes(bl.end_time)) && int4range(s, e)
  ) then
    return 'Esse horário conflita com outro agendamento ou bloqueio deste barbeiro.';
  end if;
  return null;
end $$;

create or replace function public._booking_json(b public.bookings) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'id', b.id, 'code', b.code, 'serviceId', b.service_id, 'serviceName', b.service_name,
    'price', b.price, 'duration', b.duration, 'barberId', b.barber_id, 'barberName', b.barber_name,
    'date', to_char(b.date, 'YYYY-MM-DD'), 'time', to_char(b.time, 'HH24:MI'), 'name', b.name,
    'phone', b.phone, 'notes', b.notes, 'status', b.status, 'source', b.source,
    'createdAt', b.created_at, 'history', b.history);
$$;

-- Intervalos ocupados de um dia (sem dados pessoais). barber_id null = barbearia toda.
create or replace function public.busy_intervals(p_date date)
returns table (barber_id text, booking_id uuid, start_min int, end_min int)
language sql stable security definer set search_path = public as $$
  select b.barber_id, b.id, _minutes(b.time), _minutes(b.time) + b.duration
    from bookings b where b.date = p_date and b.status in ('agendado', 'concluido')
  union all
  select bl.barber_id, null, _minutes(bl.start_time), _minutes(bl.end_time)
    from blocks bl where bl.date = p_date;
$$;

-- Cria um agendamento. Cliente: só horários da grade, nos próximos 30 dias.
-- Equipe logada: qualquer horário dentro do expediente (barbeiro só na própria agenda).
-- p_barber = 'any' (só cliente): fica com o primeiro barbeiro livre.
create or replace function public.create_booking(
  p_barber text, p_service text, p_date date, p_time time,
  p_name text, p_phone text, p_notes text default ''
) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  c_step   constant int := 30;  -- intervalo da grade de horários (min)
  c_window constant int := 30;  -- dias liberados para o cliente
  c_max    constant int := 3;   -- horários em aberto por telefone (anti-spam)
  v_staff   staff;
  v_service services;
  v_barber  text;
  v_now     timestamp := _local_now();
  v_name    text := left(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g'), 60);
  v_phone   text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  v_notes   text := left(regexp_replace(btrim(coalesce(p_notes, '')), '\s+', ' ', 'g'), 200);
  v_open    time;
  v_err     text;
  v_code    text;
  v_row     bookings;
begin
  select * into v_staff from staff where user_id = auth.uid();
  select * into v_service from services where id = p_service and active;
  if not found then raise exception using errcode = 'PT400', message = 'Serviço inválido.'; end if;
  if p_date is null or p_time is null then raise exception using errcode = 'PT400', message = 'Data ou horário inválido.'; end if;
  if length(v_name) < 2 then raise exception using errcode = 'PT400', message = 'Informe seu nome.'; end if;
  if length(v_phone) not between 10 and 13 then
    raise exception using errcode = 'PT400', message = 'Informe um telefone/WhatsApp válido com DDD.';
  end if;

  if v_staff.user_id is not null then
    v_barber := case when v_staff.role = 'barber' then v_staff.barber_id else p_barber end;
    if not exists (select 1 from barbers where id = v_barber) then
      raise exception using errcode = 'PT400', message = 'Barbeiro inválido.';
    end if;
    v_err := _placement_error(p_date, p_time, v_service.duration, v_barber, null);
    if v_err is not null then raise exception using errcode = 'PT409', message = v_err; end if;
  else
    if p_date < v_now::date or (p_date = v_now::date and p_time <= v_now::time) then
      raise exception using errcode = 'PT409', message = 'Esse horário já passou. Escolha outro.';
    end if;
    if p_date > v_now::date + c_window then
      raise exception using errcode = 'PT400', message = format('Agendamentos são liberados para os próximos %s dias.', c_window);
    end if;
    select open_time into v_open from business_hours where weekday = extract(dow from p_date)::int;
    if v_open is null or (_minutes(p_time) - _minutes(v_open)) % c_step <> 0 then
      raise exception using errcode = 'PT400', message = 'Horário inválido.';
    end if;
    if (select count(*) from bookings where phone = v_phone and status = 'agendado' and date >= v_now::date) >= c_max then
      raise exception using errcode = 'PT429',
        message = format('Você já tem %s horários marcados. Para marcar mais, fale com a barbearia no WhatsApp.', c_max);
    end if;
    if p_barber = 'any' then
      select b.id into v_barber from barbers b
        where b.active and _placement_error(p_date, p_time, v_service.duration, b.id, null) is null
        order by b.sort limit 1;
    elsif exists (select 1 from barbers where id = p_barber and active)
      and _placement_error(p_date, p_time, v_service.duration, p_barber, null) is null then
      v_barber := p_barber;
    end if;
    if v_barber is null then
      raise exception using errcode = 'PT409', message = 'Esse horário acabou de ser ocupado. Por favor, escolha outro.';
    end if;
  end if;

  loop
    select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random() * 32)::int, 1), '')
      into v_code from generate_series(1, 6);
    exit when not exists (select 1 from bookings where code = v_code);
  end loop;

  begin
    insert into bookings (code, service_id, service_name, price, duration, barber_id, barber_name,
                          date, time, name, phone, notes, source)
    select v_code, v_service.id, v_service.name, v_service.price, v_service.duration, b.id, b.name,
           p_date, p_time, v_name, v_phone, v_notes, case when v_staff.user_id is null then 'site' else 'painel' end
      from barbers b where b.id = v_barber
    returning * into v_row;
  exception when exclusion_violation then
    raise exception using errcode = 'PT409', message = 'Esse horário acabou de ser ocupado. Por favor, escolha outro.';
  end;

  return _booking_json(v_row);
end $$;

-- Altera um agendamento (equipe): remarcar (date/time/barberId), status, notes, price.
create or replace function public.update_booking(p_id uuid, p_patch jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_staff  staff;
  b        bookings;
  v_date   date;
  v_time   time;
  v_barber text;
  v_name   text;
  v_err    text;
  v_price  numeric;
  v_status text := p_patch ->> 'status';
begin
  select * into v_staff from staff where user_id = auth.uid();
  if not found then raise exception using errcode = 'PT401', message = 'Faça login para continuar.'; end if;
  select * into b from bookings where id = p_id for update;
  if not found then raise exception using errcode = 'PT404', message = 'Agendamento não encontrado.'; end if;
  if v_staff.role = 'barber' and b.barber_id <> v_staff.barber_id then
    raise exception using errcode = 'PT403', message = 'Esse agendamento é de outro barbeiro.';
  end if;

  begin
    if p_patch ? 'date' or p_patch ? 'time' or p_patch ? 'barberId' then
      v_date := coalesce((p_patch ->> 'date')::date, b.date);
      v_time := coalesce((p_patch ->> 'time')::time, b.time);
      v_barber := case when v_staff.role = 'barber' then b.barber_id else coalesce(p_patch ->> 'barberId', b.barber_id) end;
      select name into v_name from barbers where id = v_barber;
      if v_name is null then raise exception using errcode = 'PT400', message = 'Barbeiro inválido.'; end if;
      v_err := _placement_error(v_date, v_time, b.duration, v_barber, b.id);
      if v_err is not null then raise exception using errcode = 'PT409', message = v_err; end if;
      b.history := b.history || jsonb_build_array(jsonb_build_object(
        'at', now(), 'action', 'remarcado',
        'from', to_char(b.date, 'YYYY-MM-DD') || ' ' || to_char(b.time, 'HH24:MI') || case when v_barber <> b.barber_id then ' (' || b.barber_name || ')' else '' end,
        'to', to_char(v_date, 'YYYY-MM-DD') || ' ' || to_char(v_time, 'HH24:MI') || case when v_barber <> b.barber_id then ' (' || v_name || ')' else '' end));
      b.date := v_date; b.time := v_time; b.barber_id := v_barber; b.barber_name := v_name; b.status := 'agendado';
    end if;

    if v_status is not null then
      if v_status not in ('agendado', 'concluido', 'cancelado', 'faltou') then
        raise exception using errcode = 'PT400', message = 'Status inválido.';
      end if;
      if v_status = 'agendado' and b.status <> 'agendado' then
        v_err := _placement_error(b.date, b.time, b.duration, b.barber_id, b.id);
        if v_err is not null then raise exception using errcode = 'PT409', message = v_err; end if;
      end if;
      if v_status <> b.status then
        b.history := b.history || jsonb_build_array(jsonb_build_object('at', now(), 'action', v_status, 'from', b.status));
        b.status := v_status;
      end if;
    end if;

    if p_patch ? 'notes' then
      b.notes := left(regexp_replace(btrim(coalesce(p_patch ->> 'notes', '')), '\s+', ' ', 'g'), 200);
    end if;
    if p_patch ? 'price' then
      v_price := (p_patch ->> 'price')::numeric;
      if v_price is null or v_price < 0 or v_price > 10000 then raise exception using errcode = 'PT400', message = 'Valor inválido.'; end if;
      b.price := round(v_price, 2);
    end if;
  exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
    raise exception using errcode = 'PT400', message = 'Valor inválido.';
  end;

  begin
    update bookings set date = b.date, time = b.time, barber_id = b.barber_id, barber_name = b.barber_name,
                        status = b.status, notes = b.notes, price = b.price, history = b.history
      where id = b.id returning * into b;
  exception when exclusion_violation then
    raise exception using errcode = 'PT409', message = 'Esse horário conflita com outro agendamento deste barbeiro.';
  end;
  return _booking_json(b);
end $$;

-- Funções internas: ninguém chama direto.
revoke execute on function public._placement_error(date, time, int, text, uuid) from public, anon, authenticated;
grant execute on function public.busy_intervals(date) to anon, authenticated;
grant execute on function public.create_booking(text, text, date, time, text, text, text) to anon, authenticated;
revoke execute on function public.update_booking(uuid, jsonb) from public, anon;
grant execute on function public.update_booking(uuid, jsonb) to authenticated;

-- ----------------------------------------------------------------- cadastro inicial
insert into public.barbers (id, name, role, owner, bio, sort) values
  ('adao',    'Adão Machado',       'Barbeiro Proprietário', true,  'Fundador da Barbearia Machado. Corte, barba e prótese capilar com o padrão da casa.', 1),
  ('emanuel', 'Emanuel Zampieri',   'Barbeiro',              false, 'Degradês, cortes na tesoura e barba alinhada na navalha.', 2),
  ('nick',    'Nick Barber',        'Barbeiro',              false, 'Do navalhado ao platinado, com acabamento caprichado.', 3),
  ('joao',    'João Wesley Oberek', 'Barbeiro',              false, 'Corte, barba terapia e tratamentos para cabelo e barba.', 4)
on conflict (id) do update set name = excluded.name, role = excluded.role, owner = excluded.owner,
  bio = excluded.bio, sort = excluded.sort;

insert into public.services (id, cat, name, price, duration, description, tag, sort) values
  ('corte',               'Cabelo',                'Corte de Cabelo',                      45,   40, 'Degradê, social ou na tesoura, com acabamento na navalha.', null, 1),
  ('navalhado',           'Cabelo',                'Navalhado',                            50,   40, 'Corte com acabamento completo na navalha.', null, 2),
  ('alistamento',         'Cabelo',                'Alistamento Americano 🇺🇸',            70,   40, 'O corte militar no estilo americano, bem batido.', null, 3),
  ('sobrancelha',         'Cabelo',                'Sobrancelha',                          15,   15, 'Sobrancelha alinhada na navalha.', null, 4),
  ('pezinho',             'Cabelo',                'Pezinho',                              15,   15, 'Acabamento do contorno entre um corte e outro.', null, 5),
  ('barba',               'Barba',                 'Barba',                                45,   30, 'Barba alinhada e desenhada na navalha.', null, 6),
  ('barba-terapia',       'Barba',                 'Barba Terapia',                        45,   40, 'Barba com toalha quente e cuidado relaxante.', null, 7),
  ('hidratacao-barba',    'Barba',                 'Hidratação de Barba',                  30,   30, 'Fios macios e barba com brilho saudável.', null, 8),
  ('barba-pintura',       'Barba',                 'Barba + Pintura de Barba',             95,   60, 'Barba feita com pigmentação para cobrir falhas e fios brancos.', null, 9),
  ('corte-barba',         'Combos',                'Corte de Cabelo + Barba',              90,   60, 'O combo clássico: corte e barba completos.', 'Mais pedido', 10),
  ('completo',            'Combos',                'Corte + Barba Terapia + Sobrancelha',  95,   75, 'O pacote completo para sair impecável.', 'Mais completo', 11),
  ('corte-sobrancelha',   'Combos',                'Corte de Cabelo + Sobrancelha',        50,   45, 'Corte com sobrancelha alinhada.', null, 12),
  ('barba-pezinho',       'Combos',                'Barba + Pezinho',                      60,   45, 'Barba feita e contorno do cabelo em dia.', null, 13),
  ('hidratacao-cabelo',   'Química e tratamentos', 'Hidratação de Cabelo',                 30,   30, 'Tratamento para fios macios e saudáveis.', null, 14),
  ('limpeza-pele',        'Química e tratamentos', 'Limpeza de Pele',                      30,   30, 'Limpeza facial para uma pele renovada.', null, 15),
  ('pintura-cabelo',      'Química e tratamentos', 'Pintura de Cabelo',                    100,  60, 'Coloração para cobrir fios brancos ou mudar o tom.', null, 16),
  ('platinado',           'Química e tratamentos', 'Platinado',                            200, 180, 'Descoloração completa para o loiro platinado.', null, 17),
  ('luzes',               'Química e tratamentos', 'Luzes',                                200, 150, 'Mechas para iluminar o corte.', null, 18),
  ('protese-avaliacao',   'Prótese capilar',       'Avaliação Prótese Capilar',            0,    30, 'Análise do seu caso para indicar a prótese ideal.', 'Comece aqui', 19),
  ('protese-micropele',   'Prótese capilar',       'Aplicação Prótese Capilar Micro Pele', 2000, 180, 'Prótese com base em micro pele, de aparência natural.', null, 20),
  ('protese-fio-a-fio',   'Prótese capilar',       'Aplicação Prótese Fio a Fio',          600, 120, 'Aplicação fio a fio para preencher as áreas com falha.', null, 21),
  ('protese-manutencao',  'Prótese capilar',       'Manutenção Prótese Capilar',           80,   60, 'Limpeza, nova fixação e ajustes da prótese.', null, 22),
  ('protese-tonalizacao', 'Prótese capilar',       'Tonalização Prótese Capilar',          120,  60, 'Ajuste da cor da prótese ao seu cabelo natural.', null, 23)
on conflict (id) do update set cat = excluded.cat, name = excluded.name, price = excluded.price,
  duration = excluded.duration, description = excluded.description, tag = excluded.tag, sort = excluded.sort;

insert into public.business_hours (weekday, open_time, close_time) values
  (1, '09:00', '20:00'), (2, '09:00', '20:00'), (3, '09:00', '20:00'),
  (4, '09:00', '20:00'), (5, '09:00', '20:00'), (6, '08:30', '16:00')
on conflict (weekday) do update set open_time = excluded.open_time, close_time = excluded.close_time;
