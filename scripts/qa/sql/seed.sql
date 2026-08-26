-- Three accounts. A asks B. C is the one trying things on.
insert into auth.users (id) values
  ('11111111-1111-1111-1111-111111111111'),
  ('22222222-2222-2222-2222-222222222222'),
  ('33333333-3333-3333-3333-333333333333')
on conflict do nothing;

insert into public.profiles (id, username, avatar_seed, friend_code) values
  ('11111111-1111-1111-1111-111111111111', 'brave-otter-101', 'aa11', 'AAA111'),
  ('22222222-2222-2222-2222-222222222222', 'calm-heron-202',  'bb22', 'BBB222'),
  ('33333333-3333-3333-3333-333333333333', 'bold-lynx-303',   'cc33', 'CCC333')
on conflict do nothing;

-- Every table's grants, for tables that already existed before the default
-- privileges above were set.
grant select, insert, update, delete on all tables in schema public
  to anon, authenticated, service_role;
