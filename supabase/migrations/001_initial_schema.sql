-- ============================================================
-- 001_initial_schema.sql
-- Revenue Management Tool — firm + user foundation.
-- Every business table is firm-scoped via RLS on get_my_firm_id().
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- firms
CREATE TABLE IF NOT EXISTS firms (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text        NOT NULL,
  abn         text,
  created_at  timestamptz DEFAULT now()
);

-- users (one row per auth user; written ONLY by the service role)
CREATE TABLE IF NOT EXISTS users (
  id          uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  firm_id     uuid        NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  email       text        NOT NULL,
  full_name   text,
  role        text        NOT NULL DEFAULT 'staff' CHECK (role IN ('admin','adviser','staff')),
  is_active   boolean     NOT NULL DEFAULT true,
  created_at  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS users_firm_id_idx ON users(firm_id);

-- The caller's firm, or NULL for an unknown/inactive user (so they read nothing).
CREATE OR REPLACE FUNCTION public.get_my_firm_id()
RETURNS uuid
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT firm_id FROM public.users WHERE id = auth.uid() AND is_active
$$;

ALTER TABLE firms ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS firms_select ON firms;
CREATE POLICY firms_select ON firms
  FOR SELECT TO authenticated
  USING (id = public.get_my_firm_id());

DROP POLICY IF EXISTS users_select ON users;
CREATE POLICY users_select ON users
  FOR SELECT TO authenticated
  USING (firm_id = public.get_my_firm_id());

-- No INSERT/UPDATE/DELETE policies: firms and users are managed by the
-- service role only.
REVOKE INSERT, UPDATE, DELETE ON firms, users FROM authenticated, anon;
