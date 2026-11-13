-- Run manually in the Supabase SQL editor after replacing both placeholders.
-- Set ADMIN_HOOK_SECRET to the same random value in the admin deployment.
-- The webhook body contains only a masked email. pg_net queues the request asynchronously.
create schema if not exists extensions;
create extension if not exists pg_net with schema extensions;

create or replace function public.notify_admin_new_user() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  begin
    perform net.http_post(
      url := 'https://<ADMIN_DOMAIN>/api/hook',
      headers := jsonb_build_object('Content-Type', 'application/json', 'X-Hook-Secret', '<HOOK_SECRET>'),
      body := jsonb_build_object(
        'type', 'signup',
        'email_masked', case
          when position('@' in coalesce(new.email, '')) > 1
          then left(split_part(lower(new.email), '@', 1), 1) || '***@' || split_part(lower(new.email), '@', 2)
          else 'unknown'
        end,
        'created_at', new.created_at
      )
    );
  exception when others then null;
  end;
  return new;
end;
$$;

drop trigger if exists admin_new_user_push on auth.users;
create trigger admin_new_user_push after insert on auth.users
for each row execute function public.notify_admin_new_user();

-- Rollback (run separately):
-- drop trigger if exists admin_new_user_push on auth.users;
-- drop function if exists public.notify_admin_new_user();
