-- ============================================================
-- 002_user_invites.sql
-- Invite-only accounts. An admin (or the service role) records an invite;
-- when a Supabase Auth user with that email exists AND is confirmed, the
-- trigger below creates their public.users row in the invited firm/role.
-- Signing up without an invite creates an auth user with no users row, so
-- get_my_firm_id() is NULL and RLS returns nothing.
-- ============================================================

CREATE TABLE IF NOT EXISTS user_invites (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id      uuid        NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  email        text        NOT NULL,
  full_name    text,
  role         text        NOT NULL DEFAULT 'staff' CHECK (role IN ('admin','adviser','staff')),
  accepted_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS user_invites_email_key ON user_invites (lower(email));

ALTER TABLE user_invites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_invites_select ON user_invites;
CREATE POLICY user_invites_select ON user_invites
  FOR SELECT TO authenticated
  USING (firm_id = public.get_my_firm_id());

REVOKE INSERT, UPDATE, DELETE ON user_invites FROM authenticated, anon;

-- Fires on insert (dashboard "Add user" with auto-confirm) and on later
-- confirmation (email link). Only a CONFIRMED email can claim an invite, so
-- someone signing up with another person's address can't take their seat.
CREATE OR REPLACE FUNCTION public.handle_auth_user_confirmed()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inv public.user_invites%ROWTYPE;
BEGIN
  IF NEW.email_confirmed_at IS NULL OR NEW.email IS NULL THEN
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM public.users WHERE id = NEW.id) THEN
    RETURN NEW;
  END IF;

  SELECT * INTO inv
  FROM public.user_invites
  WHERE lower(email) = lower(NEW.email) AND accepted_at IS NULL;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.users (id, firm_id, email, full_name, role)
  VALUES (NEW.id, inv.firm_id, NEW.email, inv.full_name, inv.role);

  UPDATE public.user_invites SET accepted_at = now() WHERE id = inv.id;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.handle_auth_user_confirmed() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS on_auth_user_confirmed ON auth.users;
CREATE TRIGGER on_auth_user_confirmed
  AFTER INSERT OR UPDATE OF email_confirmed_at ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_auth_user_confirmed();
