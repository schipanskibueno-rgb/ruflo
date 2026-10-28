-- =============================================================================
-- Barbearia Machado — acesso ao painel (rode DEPOIS de schema.sql)
--
-- 1. Supabase → Authentication → Users → "Add user" → "Create new user":
--    crie um usuário (e-mail + senha, marque "Auto Confirm User") para o dono
--    e um para cada barbeiro.
-- 2. Troque os e-mails abaixo pelos que você cadastrou e rode no SQL Editor.
--
-- role 'admin'  = dono: vê e gerencia a agenda de todos.
-- role 'barber' = barbeiro: vê e gerencia só a própria agenda.
-- =============================================================================

insert into public.staff (user_id, role, barber_id)
select u.id, v.role, v.barber_id
from (values
  ('adao@exemplo.com',    'admin',  'adao'),
  ('emanuel@exemplo.com', 'barber', 'emanuel'),
  ('nick@exemplo.com',    'barber', 'nick'),
  ('joao@exemplo.com',    'barber', 'joao')
) as v (email, role, barber_id)
join auth.users u on lower(u.email) = lower(v.email)
on conflict (user_id) do update set role = excluded.role, barber_id = excluded.barber_id;

-- Confira: deve listar as 4 pessoas.
select u.email, s.role, s.barber_id from public.staff s join auth.users u on u.id = s.user_id;
