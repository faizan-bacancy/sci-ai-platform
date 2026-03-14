-- Allow trusted backend/admin sessions to update protected profile fields.
-- Keeps normal user restrictions unchanged.
create or replace function public.enforce_profile_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  user_role_value public.user_role;
  jwt_role text;
begin
  user_role_value := public.get_user_role();
  jwt_role := current_setting('request.jwt.claim.role', true);

  if coalesce(jwt_role, '') = 'service_role' or current_user in ('postgres', 'supabase_admin') then
    return new;
  end if;

  if user_role_value <> 'admin'::public.user_role then
    if new.id <> old.id then
      raise exception 'Cannot change profile id';
    end if;

    if new.email <> old.email then
      raise exception 'Cannot change profile email';
    end if;

    if new.role <> old.role then
      raise exception 'Cannot change role';
    end if;

    if new.is_active <> old.is_active then
      raise exception 'Cannot change is_active';
    end if;
  end if;

  return new;
end;
$function$;
