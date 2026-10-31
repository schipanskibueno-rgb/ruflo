-- =============================================================================
-- Barbearia Machado — banco de dados do agendamento (Supabase)
--
-- Como usar: Supabase → SQL Editor → New query → cole este arquivo inteiro → Run.
-- Pode rodar de novo sem perder agendamentos nem senhas (os cadastros de
-- barbeiros, serviços e horários voltam aos valores deste arquivo).
--
-- Quem pode o quê:
--   • Cliente (sem login): vê barbeiros, serviços, horários e quais intervalos
--     estão ocupados (sem nome nem telefone de ninguém) e cria agendamento.
--   • Dono (senha do Adão): vê e gerencia tudo.
--   • Barbeiro (senha própria): vê e gerencia só a própria agenda.
--
-- Senhas iniciais do painel (cada pessoa precisa ter uma senha diferente):
--   Adão (dono): machado26 · Emanuel: emanuel26 · Nick: nick26 · João: joao26
-- Para trocar uma senha, rode no SQL Editor (troque o id e a senha):
--   update public.staff_access set pass_hash = extensions.crypt('NOVA-SENHA', extensions.gen_salt('bf'))
--   where id = 'nick';      -- ids: adao, emanuel, nick, joao
-- =============================================================================

create schema if not exists extensions;
create extension if not exists btree_gist;
create extension if not exists pgcrypto with schema extensions;

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

-- Quem acessa o painel: uma senha por pessoa (guardada só como hash).
drop table if exists public.staff cascade;  -- versão antiga, com login por e-mail
create table if not exists public.staff_access (
  id        text primary key,
  role      text not null check (role in ('admin', 'barber')),
  barber_id text references public.barbers (id),
  pass_hash text not null,
  check (role = 'admin' or barber_id is not null)
);

-- Sessões do painel: o navegador guarda o token; aqui fica só o hash dele.
create table if not exists public.staff_sessions (
  token_hash text primary key,
  staff_id   text not null references public.staff_access (id) on delete cascade,
  expires_at timestamptz not null
);

-- Tentativas de login erradas (trava contra chute de senha).
create table if not exists public.login_failures (
  ip text not null,
  at timestamptz not null default now()
);
create index if not exists login_failures_at_idx on public.login_failures (at);

-- Aparelhos que ativaram as notificações (Web Push). Só as funções e a Netlify (chave secreta) leem.
create table if not exists public.push_subscriptions (
  endpoint   text primary key,
  staff_id   text not null references public.staff_access (id) on delete cascade,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;

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
-- Colunas adicionadas depois (rodar de novo atualiza bancos antigos).
alter table public.bookings add column if not exists series_id uuid;            -- agendamento recorrente (todo mês)
alter table public.bookings add column if not exists completed_at timestamptz;  -- quando foi marcado como concluído
update public.bookings set completed_at = (date + time) at time zone 'America/Sao_Paulo'
  where status = 'concluido' and completed_at is null;
create index if not exists bookings_date_idx on public.bookings (date);
create index if not exists bookings_series_idx on public.bookings (series_id);
-- Avisos no celular (função agendada da Netlify): marca o que já foi avisado.
alter table public.bookings add column if not exists notified_new_at timestamptz;    -- "novo agendamento"
alter table public.bookings add column if not exists notified_start_at timestamptz;  -- "atendimento agora"
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

-- Comissão de cada barbeiro (% sobre cada atendimento concluído). Só o dono vê.
create table if not exists public.commission_rates (
  barber_id  text primary key references public.barbers (id) on delete cascade,
  pct        numeric(5, 2) not null check (pct between 0 and 100),
  updated_at timestamptz not null default now()
);

-- Pagamentos de comissão: cada "zerar" do dono vira um registro; a contagem recomeça dali.
create table if not exists public.payouts (
  id        uuid primary key default gen_random_uuid(),
  barber_id text not null references public.barbers (id) on delete cascade,
  since     timestamptz,                -- início do que foi pago (null = desde o começo)
  paid_at   timestamptz not null default now(),
  pct       numeric(5, 2) not null,
  count     int not null,
  gross     numeric(10, 2) not null,
  amount    numeric(10, 2) not null
);
create index if not exists payouts_barber_idx on public.payouts (barber_id, paid_at desc);

create table if not exists public.gallery (
  id         uuid primary key default gen_random_uuid(),
  image      text not null check (image ~ '^data:image/(jpeg|png|webp);base64,' and length(image) < 3000000),
  caption    text not null default '',
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------- quem é quem
-- O painel manda o token da sessão no cabeçalho "x-staff-token" de cada requisição.
create or replace function public._request_token_hash() returns text
language sql stable as $$
  select encode(extensions.digest(nullif(current_setting('request.headers', true)::json ->> 'x-staff-token', ''), 'sha256'), 'hex');
$$;

-- Pessoa logada no painel (vazio para clientes).
create or replace function public._current_staff() returns setof public.staff_access
language sql stable security definer set search_path = public as $$
  select a.* from staff_sessions s join staff_access a on a.id = s.staff_id
  where s.token_hash = _request_token_hash() and s.expires_at > now();
$$;

create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from _current_staff());
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from _current_staff() where role = 'admin');
$$;

-- Barbeiro logado (null para o dono e para clientes).
create or replace function public.my_barber() returns text
language sql stable security definer set search_path = public as $$
  select barber_id from _current_staff() where role = 'barber';
$$;

-- ----------------------------------------------------------------- regras de acesso (RLS)
alter table public.barbers        enable row level security;
alter table public.services       enable row level security;
alter table public.business_hours enable row level security;
alter table public.staff_access   enable row level security;
alter table public.staff_sessions enable row level security;
alter table public.login_failures enable row level security;
alter table public.bookings       enable row level security;
alter table public.blocks         enable row level security;
alter table public.gallery        enable row level security;
alter table public.commission_rates enable row level security;
alter table public.payouts          enable row level security;

drop policy if exists "leitura publica" on public.barbers;
drop policy if exists "dono edita" on public.barbers;
create policy "leitura publica" on public.barbers for select using (true);
create policy "dono edita" on public.barbers for all using (is_admin()) with check (is_admin());

drop policy if exists "leitura publica" on public.services;
drop policy if exists "dono edita" on public.services;
create policy "leitura publica" on public.services for select using (true);
create policy "dono edita" on public.services for all using (is_admin()) with check (is_admin());

drop policy if exists "leitura publica" on public.business_hours;
drop policy if exists "dono edita" on public.business_hours;
create policy "leitura publica" on public.business_hours for select using (true);
create policy "dono edita" on public.business_hours for all using (is_admin()) with check (is_admin());

-- staff_access, staff_sessions e login_failures: sem regras = ninguém lê pela API
-- (só as funções do banco acessam).

-- Agendamentos: cliente não lê nada (cria pela função create_booking);
-- equipe lê pela tabela e altera pela função update_booking.
drop policy if exists "equipe le" on public.bookings;
create policy "equipe le" on public.bookings for select
  using (is_admin() or barber_id = my_barber());

drop policy if exists "equipe le" on public.blocks;
drop policy if exists "equipe cria" on public.blocks;
drop policy if exists "equipe remove" on public.blocks;
create policy "equipe le" on public.blocks for select using (is_staff());
create policy "equipe cria" on public.blocks for insert
  with check (is_admin() or (barber_id is not null and barber_id = my_barber()));
create policy "equipe remove" on public.blocks for delete
  using (is_admin() or (barber_id is not null and barber_id = my_barber()));

drop policy if exists "dono gerencia" on public.commission_rates;
create policy "dono gerencia" on public.commission_rates for all using (is_admin()) with check (is_admin());

drop policy if exists "dono e barbeiro leem" on public.payouts;
create policy "dono e barbeiro leem" on public.payouts for select using (is_admin() or barber_id = my_barber());

drop policy if exists "leitura publica" on public.gallery;
drop policy if exists "equipe envia" on public.gallery;
drop policy if exists "equipe remove" on public.gallery;
create policy "leitura publica" on public.gallery for select using (true);
create policy "equipe envia" on public.gallery for insert with check (is_staff());
create policy "equipe remove" on public.gallery for delete using (is_staff());

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
    'createdAt', b.created_at, 'history', b.history, 'seriesId', b.series_id, 'completedAt', b.completed_at);
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

create or replace function public._new_booking_code() returns text
language plpgsql volatile security definer set search_path = public as $$
declare v_code text;
begin
  loop
    select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random() * 32)::int, 1), '')
      into v_code from generate_series(1, 6);
    exit when not exists (select 1 from bookings where code = v_code);
  end loop;
  return v_code;
end $$;

-- Cria um agendamento. Cliente: só horários da grade, nos próximos 30 dias.
-- Equipe logada: qualquer horário dentro do expediente (barbeiro só na própria agenda).
-- p_barber = 'any' (só cliente): fica com o primeiro barbeiro livre.
-- Mesmo dia da semana na mesma posição do mês (ex.: 2ª quinta). 5ª ocorrência = última do mês.
create or replace function public._same_weekday_in_month(p_date date, p_months int) returns date
language plpgsql immutable as $$
declare
  n     int := least(((extract(day from p_date)::int - 1) / 7) + 1, 5);
  w     int := extract(dow from p_date)::int;
  first date := (date_trunc('month', p_date) + make_interval(months => p_months))::date;
  d     date;
begin
  d := first + ((w - extract(dow from first)::int + 7) % 7) + (n - 1) * 7;
  if n = 5 or extract(month from d) <> extract(month from first) then
    d := first + ((w - extract(dow from first)::int + 7) % 7);
    while extract(month from d + 7) = extract(month from first) loop d := d + 7; end loop;
  end if;
  return d;
end $$;

drop function if exists public.create_booking(text, text, date, time, text, text, text);
create or replace function public.create_booking(
  p_barber text, p_service text, p_date date, p_time time,
  p_name text, p_phone text, p_notes text default '', p_repeat boolean default false
) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  c_step   constant int := 30;  -- intervalo da grade de horários (min)
  c_window constant int := 30;  -- dias liberados para o cliente
  c_max    constant int := 3;   -- horários em aberto por telefone (anti-spam; série recorrente conta 1)
  c_months constant int := 6;   -- meses criados de uma vez num agendamento recorrente
  v_staff   staff_access;
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
  v_series  uuid;
  v_next    date;
  v_code2   text;
  v_dates   jsonb := '[]';
  v_skipped jsonb := '[]';
begin
  select * into v_staff from _current_staff();
  select * into v_service from services where id = p_service and active;
  if not found then raise exception using errcode = 'PT400', message = 'Serviço inválido.'; end if;
  if p_date is null or p_time is null then raise exception using errcode = 'PT400', message = 'Data ou horário inválido.'; end if;
  if length(v_name) < 2 then raise exception using errcode = 'PT400', message = 'Informe seu nome.'; end if;
  if length(v_phone) not between 10 and 13 then
    raise exception using errcode = 'PT400', message = 'Informe um telefone/WhatsApp válido com DDD.';
  end if;

  if v_staff.id is not null then
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
    if (select count(distinct coalesce(series_id, id)) from bookings
        where phone = v_phone and status = 'agendado' and date >= v_now::date) >= c_max then
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

  if p_repeat then v_series := gen_random_uuid(); end if;
  v_code := _new_booking_code();
  begin
    insert into bookings (code, service_id, service_name, price, duration, barber_id, barber_name,
                          date, time, name, phone, notes, source, series_id)
    select v_code, v_service.id, v_service.name, v_service.price, v_service.duration, b.id, b.name,
           p_date, p_time, v_name, v_phone, v_notes, case when v_staff.id is null then 'site' else 'painel' end, v_series
      from barbers b where b.id = v_barber
    returning * into v_row;
  exception when exclusion_violation then
    raise exception using errcode = 'PT409', message = 'Esse horário acabou de ser ocupado. Por favor, escolha outro.';
  end;

  -- Recorrente: mesmo barbeiro, horário e dia da semana do mês, nos próximos meses.
  -- Mês em que o horário já está ocupado ou bloqueado fica de fora (avisado no retorno).
  if p_repeat then
    v_dates := jsonb_build_array(to_char(p_date, 'YYYY-MM-DD'));
    for i in 1 .. c_months - 1 loop
      v_next := _same_weekday_in_month(p_date, i);
      if _placement_error(v_next, p_time, v_service.duration, v_barber, null) is not null then
        v_skipped := v_skipped || to_jsonb(to_char(v_next, 'YYYY-MM-DD'));
        continue;
      end if;
      v_code2 := _new_booking_code();
      begin
        insert into bookings (code, service_id, service_name, price, duration, barber_id, barber_name,
                              date, time, name, phone, notes, source, series_id)
        values (v_code2, v_row.service_id, v_row.service_name, v_row.price, v_row.duration, v_row.barber_id,
                v_row.barber_name, v_next, p_time, v_name, v_phone, v_notes, v_row.source, v_series);
        v_dates := v_dates || to_jsonb(to_char(v_next, 'YYYY-MM-DD'));
      exception when exclusion_violation then
        v_skipped := v_skipped || to_jsonb(to_char(v_next, 'YYYY-MM-DD'));
      end;
    end loop;
  end if;

  return _booking_json(v_row) || jsonb_build_object('repeatDates', v_dates, 'repeatSkipped', v_skipped);
end $$;

-- Altera um agendamento (equipe): remarcar (date/time/barberId), status, notes, price.
create or replace function public.update_booking(p_id uuid, p_patch jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_staff  staff_access;
  b        bookings;
  v_date   date;
  v_time   time;
  v_barber text;
  v_name   text;
  v_err    text;
  v_price  numeric;
  v_status text := p_patch ->> 'status';
begin
  select * into v_staff from _current_staff();
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
      b.completed_at := null;
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
        b.completed_at := case when v_status = 'concluido' then now() end;
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
                        status = b.status, notes = b.notes, price = b.price, history = b.history,
                        completed_at = b.completed_at
      where id = b.id returning * into b;
  exception when exclusion_violation then
    raise exception using errcode = 'PT409', message = 'Esse horário conflita com outro agendamento deste barbeiro.';
  end;
  return _booking_json(b);
end $$;

-- Cancela um agendamento recorrente a partir de uma data (equipe; barbeiro só a própria agenda).
create or replace function public.cancel_series(p_series uuid, p_from date)
returns int language plpgsql volatile security definer set search_path = public as $$
declare
  v_staff staff_access;
  v_n     int;
begin
  select * into v_staff from _current_staff();
  if not found then raise exception using errcode = 'PT401', message = 'Faça login para continuar.'; end if;
  update bookings set status = 'cancelado',
         history = history || jsonb_build_array(jsonb_build_object('at', now(), 'action', 'cancelado', 'from', status, 'serie', true))
   where series_id = p_series and date >= p_from and status = 'agendado'
     and (v_staff.role = 'admin' or barber_id = v_staff.barber_id);
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- ----------------------------------------------------------------- comissões
-- Quanto o barbeiro tem a receber desde o último pagamento (atendimentos concluídos depois dele).
create or replace function public._commission_summary(p_barber text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  c_default constant numeric := 50;   -- % usada enquanto o dono não define (igual à página)
  v_since timestamptz;
  v_pct   numeric;
  v_items jsonb;
  v_count int;
  v_gross numeric;
begin
  select max(paid_at) into v_since from payouts where barber_id = p_barber;
  select coalesce((select pct from commission_rates where barber_id = p_barber), c_default) into v_pct;
  select count(*), coalesce(sum(price), 0),
         coalesce(jsonb_agg(jsonb_build_object('date', to_char(date, 'YYYY-MM-DD'), 'time', to_char(time, 'HH24:MI'),
                  'serviceName', service_name, 'price', price) order by date, time), '[]')
    into v_count, v_gross, v_items
    from bookings
   where barber_id = p_barber and status = 'concluido' and completed_at is not null
     and (v_since is null or completed_at > v_since);
  return jsonb_build_object('barberId', p_barber, 'since', v_since, 'pct', v_pct, 'count', v_count,
                            'gross', v_gross, 'amount', round(v_gross * v_pct / 100, 2), 'items', v_items);
end $$;

-- Resumo para o painel: o dono vê de qualquer barbeiro; o barbeiro, só o dele.
create or replace function public.commission_summary(p_barber text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_staff staff_access;
begin
  select * into v_staff from _current_staff();
  if not found then raise exception using errcode = 'PT401', message = 'Faça login para continuar.'; end if;
  if v_staff.role = 'barber' then return _commission_summary(v_staff.barber_id); end if;
  if p_barber is null then raise exception using errcode = 'PT400', message = 'Barbeiro inválido.'; end if;
  return _commission_summary(p_barber);
end $$;

-- Dono paga e zera: registra o pagamento e a contagem do barbeiro recomeça de agora.
create or replace function public.close_commission(p_barber text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_sum jsonb;
  v_row payouts;
begin
  if not is_admin() then raise exception using errcode = 'PT403', message = 'Só o dono pode zerar as comissões.'; end if;
  perform pg_advisory_xact_lock(hashtext('payout:' || p_barber));
  v_sum := _commission_summary(p_barber);
  if (v_sum ->> 'count')::int = 0 then
    raise exception using errcode = 'PT400', message = 'Nada a pagar desde o último pagamento.';
  end if;
  insert into payouts (barber_id, since, pct, count, gross, amount)
  values (p_barber, (v_sum ->> 'since')::timestamptz, (v_sum ->> 'pct')::numeric, (v_sum ->> 'count')::int,
          (v_sum ->> 'gross')::numeric, (v_sum ->> 'amount')::numeric)
  returning * into v_row;
  return to_jsonb(v_row);
end $$;

-- ----------------------------------------------------------------- login do painel
-- Entra só com a senha: cada pessoa tem uma senha diferente.
-- Não usa "raise" no erro para gravar a tentativa errada (raise desfaria o insert).
create or replace function public.staff_login(p_password text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  c_max_ip     constant int := 8;   -- tentativas erradas por IP em 15 min
  c_max_global constant int := 60;  -- tentativas erradas no total em 15 min
  v_ip    text := coalesce(nullif(btrim(split_part(current_setting('request.headers', true)::json ->> 'x-forwarded-for', ',', 1)), ''), 'desconhecido');
  v_staff staff_access;
  v_token text;
begin
  delete from login_failures where at < now() - interval '1 day';
  delete from staff_sessions where expires_at < now();
  if (select count(*) from login_failures where ip = v_ip and at > now() - interval '15 minutes') >= c_max_ip
     or (select count(*) from login_failures where at > now() - interval '15 minutes') >= c_max_global then
    return jsonb_build_object('ok', false, 'status', 429, 'message', 'Muitas tentativas. Aguarde 15 minutos e tente de novo.');
  end if;
  select * into v_staff from staff_access
    where length(coalesce(p_password, '')) > 0 and pass_hash = extensions.crypt(p_password, pass_hash)
    order by id limit 1;
  if not found then
    insert into login_failures (ip) values (v_ip);
    return jsonb_build_object('ok', false, 'status', 401, 'message', 'Senha incorreta.');
  end if;
  v_token := encode(extensions.gen_random_bytes(24), 'hex');
  insert into staff_sessions (token_hash, staff_id, expires_at)
    values (encode(extensions.digest(v_token, 'sha256'), 'hex'), v_staff.id, now() + interval '30 days');
  return jsonb_build_object('ok', true, 'token', v_token, 'role', v_staff.role, 'barberId', v_staff.barber_id);
end $$;

-- Quem está logado (pelo token do cabeçalho), ou null.
create or replace function public.staff_me() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', id, 'role', role, 'barberId', barber_id) from _current_staff();
$$;

create or replace function public.staff_logout() returns void
language sql volatile security definer set search_path = public as $$
  delete from staff_sessions where token_hash = _request_token_hash();
$$;

-- ----------------------------------------------------------------- notificações no celular
-- O painel salva o aparelho do barbeiro logado para receber os avisos.
create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text)
returns void language plpgsql volatile security definer set search_path = public as $$
declare v_staff staff_access;
begin
  select * into v_staff from _current_staff();
  if not found then raise exception using errcode = 'PT401', message = 'Faça login para continuar.'; end if;
  if coalesce(p_endpoint, '') !~ '^https://' or length(p_endpoint) > 1000 or coalesce(p_p256dh, '') = '' or coalesce(p_auth, '') = '' then
    raise exception using errcode = 'PT400', message = 'Inscrição de notificação inválida.';
  end if;
  insert into push_subscriptions (endpoint, staff_id, p256dh, auth) values (p_endpoint, v_staff.id, p_p256dh, p_auth)
  on conflict (endpoint) do update set staff_id = excluded.staff_id, p256dh = excluded.p256dh, auth = excluded.auth;
end $$;

create or replace function public.delete_push_subscription(p_endpoint text)
returns void language sql volatile security definer set search_path = public as $$
  delete from push_subscriptions where endpoint = p_endpoint and staff_id in (select id from _current_staff());
$$;

-- Funções internas: ninguém chama direto.
revoke execute on function public._placement_error(date, time, int, text, uuid) from public, anon, authenticated;
revoke execute on function public._current_staff() from public, anon, authenticated;
grant execute on function public.busy_intervals(date) to anon, authenticated;
grant execute on function public.create_booking(text, text, date, time, text, text, text, boolean) to anon, authenticated;
grant execute on function public.cancel_series(uuid, date) to anon, authenticated;
grant execute on function public.commission_summary(text) to anon, authenticated;
grant execute on function public.close_commission(text) to anon, authenticated;
revoke execute on function public._commission_summary(text) from public, anon, authenticated;
revoke execute on function public._new_booking_code() from public, anon, authenticated;
grant execute on function public.update_booking(uuid, jsonb) to anon, authenticated;
grant execute on function public.staff_login(text) to anon, authenticated;
grant execute on function public.staff_me() to anon, authenticated;
grant execute on function public.staff_logout() to anon, authenticated;
grant execute on function public.save_push_subscription(text, text, text) to anon, authenticated;
grant execute on function public.delete_push_subscription(text) to anon, authenticated;

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

-- Acesso ao painel. Só cria se ainda não existir: rodar de novo não apaga senhas trocadas.
insert into public.staff_access (id, role, barber_id, pass_hash) values
  ('adao',    'admin',  'adao',    extensions.crypt('machado26', extensions.gen_salt('bf'))),
  ('emanuel', 'barber', 'emanuel', extensions.crypt('emanuel26', extensions.gen_salt('bf'))),
  ('nick',    'barber', 'nick',    extensions.crypt('nick26',    extensions.gen_salt('bf'))),
  ('joao',    'barber', 'joao',    extensions.crypt('joao26',    extensions.gen_salt('bf')))
on conflict (id) do nothing;
