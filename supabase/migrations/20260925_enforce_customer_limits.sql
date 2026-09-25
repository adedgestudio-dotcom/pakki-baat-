CREATE OR REPLACE FUNCTION public.save_workspace(payload jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_plan text;
  v_status text;
  v_period_end timestamptz;
  v_limit integer;

  v_existing_payload jsonb;
  v_existing_customers text[];
  v_new_customers text[];

  v_existing_count integer := 0;
  v_new_count integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select plan, status, period_end
    into v_plan, v_status, v_period_end
  from public.subscriptions
  where owner_id = auth.uid();

  if not found then
    raise exception 'SUBSCRIPTION_INACTIVE';
  end if;

  if v_status <> 'active' or v_period_end <= now() then
    raise exception 'SUBSCRIPTION_INACTIVE';
  end if;

  v_limit :=
    case v_plan
      when 'trial' then 100
      when 'basic' then 100
      when 'smart' then 250
      when 'business' then null
      else 0
    end;

  /*
    Build a normalized customer list from every place in the
    workspace that currently contributes to customerNames:
      jobs
      payments
      notes
      reminders
      customerPhones
  */

  select coalesce(array_agg(distinct customer), array[]::text[])
  into v_new_customers
  from (
    select lower(trim(x->>'customer')) as customer
    from jsonb_array_elements(
      case
        when jsonb_typeof(payload->'jobs') = 'array'
          then payload->'jobs'
        else '[]'::jsonb
      end
    ) x

    union

    select lower(trim(x->>'customer'))
    from jsonb_array_elements(
      case
        when jsonb_typeof(payload->'payments') = 'array'
          then payload->'payments'
        else '[]'::jsonb
      end
    ) x

    union

    select lower(trim(x->>'customer'))
    from jsonb_array_elements(
      case
        when jsonb_typeof(payload->'notes') = 'array'
          then payload->'notes'
        else '[]'::jsonb
      end
    ) x

    union

    select lower(trim(x->>'customer'))
    from jsonb_array_elements(
      case
        when jsonb_typeof(payload->'reminders') = 'array'
          then payload->'reminders'
        else '[]'::jsonb
      end
    ) x

    union

    select lower(trim(key))
    from jsonb_object_keys(
      case
        when jsonb_typeof(payload->'customerPhones') = 'object'
          then payload->'customerPhones'
        else '{}'::jsonb
      end
    ) key
  ) customers
  where customer is not null
    and customer <> '';

  v_new_count := coalesce(array_length(v_new_customers, 1), 0);

  /*
    Business has no customer cap.
  */
  if v_limit is not null then

    select w.payload
      into v_existing_payload
    from public.workspaces w
    where w.owner_id = auth.uid();

    if v_existing_payload is not null then
      select coalesce(array_agg(distinct customer), array[]::text[])
      into v_existing_customers
      from (
        select lower(trim(x->>'customer')) as customer
        from jsonb_array_elements(
          case
            when jsonb_typeof(v_existing_payload->'jobs') = 'array'
              then v_existing_payload->'jobs'
            else '[]'::jsonb
          end
        ) x

        union

        select lower(trim(x->>'customer'))
        from jsonb_array_elements(
          case
            when jsonb_typeof(v_existing_payload->'payments') = 'array'
              then v_existing_payload->'payments'
            else '[]'::jsonb
          end
        ) x

        union

        select lower(trim(x->>'customer'))
        from jsonb_array_elements(
          case
            when jsonb_typeof(v_existing_payload->'notes') = 'array'
              then v_existing_payload->'notes'
            else '[]'::jsonb
          end
        ) x

        union

        select lower(trim(x->>'customer'))
        from jsonb_array_elements(
          case
            when jsonb_typeof(v_existing_payload->'reminders') = 'array'
              then v_existing_payload->'reminders'
            else '[]'::jsonb
          end
        ) x

        union

        select lower(trim(key))
        from jsonb_object_keys(
          case
            when jsonb_typeof(v_existing_payload->'customerPhones') = 'object'
              then v_existing_payload->'customerPhones'
            else '{}'::jsonb
          end
        ) key
      ) customers
      where customer is not null
        and customer <> '';

      v_existing_count :=
        coalesce(array_length(v_existing_customers, 1), 0);
    end if;

    /*
      Normal situation:
      Don't allow the workspace to exceed the plan limit.

      Compatibility situation:
      If an account somehow already contains more customers than
      its current plan permits, don't destroy or lock that data.
      It can keep saving as long as it doesn't increase the number.
    */
    if v_new_count > v_limit
       and v_new_count > v_existing_count then
      raise exception 'CUSTOMER_LIMIT_REACHED:%', v_limit;
    end if;
  end if;

  insert into public.workspaces(owner_id, payload)
  values(auth.uid(), payload)
  on conflict(owner_id)
  do update
    set payload = excluded.payload,
        updated_at = now();
end;
$function$