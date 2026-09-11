-- Run once in the Supabase SQL editor. Phone authentication requires an SMS provider.
create table if not exists public.workspaces (
 owner_id uuid primary key references auth.users(id) on delete cascade,
 payload jsonb not null check (jsonb_typeof(payload) = 'object'),
 updated_at timestamptz not null default now()
);
alter table public.workspaces enable row level security;
revoke all on public.workspaces from anon;
grant select, insert, update on public.workspaces to authenticated;
create policy "Read own workspace" on public.workspaces for select to authenticated using (auth.uid() = owner_id);
create policy "Insert own workspace" on public.workspaces for insert to authenticated with check (auth.uid() = owner_id);
create policy "Update own workspace" on public.workspaces for update to authenticated using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
create or replace function public.save_workspace(payload jsonb) returns void language sql security invoker set search_path = public as $$
 insert into public.workspaces(owner_id,payload) values(auth.uid(),payload)
 on conflict(owner_id) do update set payload=excluded.payload, updated_at=now();
$$;
revoke all on function public.save_workspace(jsonb) from public;
grant execute on function public.save_workspace(jsonb) to authenticated;

-- Atomic, durable quota. Only the server can consume credits.
create table if not exists public.ai_usage(owner_id uuid references auth.users(id) on delete cascade, usage_day date not null default current_date, calls integer not null default 0, primary key(owner_id,usage_day));
alter table public.ai_usage enable row level security;
revoke all on public.ai_usage from anon,authenticated;
create or replace function public.consume_ai_credit(user_id uuid) returns boolean language plpgsql security definer set search_path=public as $$
declare n integer;
begin
 insert into public.ai_usage(owner_id,usage_day,calls) values(user_id,current_date,1)
 on conflict(owner_id,usage_day) do update set calls=ai_usage.calls+1 where ai_usage.calls<30
 returning calls into n;
 return n is not null;
end;$$;
revoke all on function public.consume_ai_credit(uuid) from public,anon,authenticated;
grant execute on function public.consume_ai_credit(uuid) to service_role;
