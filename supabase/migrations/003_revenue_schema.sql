-- ============================================================
-- 003_revenue_schema.sql
-- Revenue model: advisers, shareholders, households (clients), providers,
-- client references (matching keys), statements (one per provider
-- statement / bank deposit) and revenue_lines (one per fee/commission row).
--
-- Two dates on every line drive the two reporting bases:
--   received_date     — the day the dollars reached the bank (payout basis)
--   generation_month  — the month the revenue was earned (tax/audit basis),
--                       e.g. platform fees received in September for August.
-- Money is integer CENTS. Amounts are stored EX-GST with GST separately.
-- ============================================================

-- ── Helpers ─────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.is_firm_admin()
RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users WHERE id = auth.uid() AND is_active AND role = 'admin'
  )
$$;

-- Raises unless p_id is NULL or a row of p_table in firm p_firm. Runs as the
-- caller, so under RLS another firm's row is simply invisible — FK checks
-- bypass RLS, which is why this exists.
CREATE OR REPLACE FUNCTION public.assert_in_firm(p_table regclass, p_id uuid, p_firm uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  ok boolean;
BEGIN
  IF p_id IS NULL THEN
    RETURN;
  END IF;
  EXECUTE format('SELECT EXISTS (SELECT 1 FROM %s WHERE id = $1 AND firm_id = $2)', p_table)
    INTO ok USING p_id, p_firm;
  IF NOT ok THEN
    RAISE EXCEPTION '% % does not belong to this firm', p_table, p_id USING ERRCODE = '23503';
  END IF;
END;
$$;

-- ── firm_settings ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS firm_settings (
  firm_id              uuid         PRIMARY KEY REFERENCES firms(id) ON DELETE CASCADE,
  -- Share of an UPFRONT fee/commission the adviser keeps (ex-GST).
  upfront_adviser_pct  numeric(5,2) NOT NULL DEFAULT 60 CHECK (upfront_adviser_pct BETWEEN 0 AND 100),
  -- Share of a ONE-OFF fee the adviser keeps. Ongoing is always 0 (all to the business).
  one_off_adviser_pct  numeric(5,2) NOT NULL DEFAULT 60 CHECK (one_off_adviser_pct BETWEEN 0 AND 100),
  updated_at           timestamptz  NOT NULL DEFAULT now()
);

INSERT INTO firm_settings (firm_id) SELECT id FROM firms ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.create_firm_settings()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.firm_settings (firm_id) VALUES (NEW.id) ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.create_firm_settings() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS firms_create_settings ON firms;
CREATE TRIGGER firms_create_settings AFTER INSERT ON firms
  FOR EACH ROW EXECUTE FUNCTION public.create_firm_settings();

-- ── advisers ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS advisers (
  id                 uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id            uuid         NOT NULL DEFAULT public.get_my_firm_id() REFERENCES firms(id) ON DELETE CASCADE,
  name               text         NOT NULL,
  email              text,
  -- Overrides firm_settings.upfront_adviser_pct for this adviser; NULL = firm default.
  upfront_split_pct  numeric(5,2) CHECK (upfront_split_pct BETWEEN 0 AND 100),
  is_active          boolean      NOT NULL DEFAULT true,
  created_at         timestamptz  NOT NULL DEFAULT now(),
  UNIQUE (firm_id, name)
);

-- ── shareholders ────────────────────────────────────────────
-- The business share (ongoing revenue + the business's part of upfronts) is
-- distributed by shareholding. Dated so a change in holdings doesn't rewrite
-- past periods: each month uses the rows in effect on its last day.

CREATE TABLE IF NOT EXISTS shareholders (
  id              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id         uuid         NOT NULL DEFAULT public.get_my_firm_id() REFERENCES firms(id) ON DELETE CASCADE,
  name            text         NOT NULL,
  share_pct       numeric(7,4) NOT NULL CHECK (share_pct > 0 AND share_pct <= 100),
  effective_from  date         NOT NULL DEFAULT DATE '2000-01-01',
  effective_to    date,
  created_at      timestamptz  NOT NULL DEFAULT now(),
  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

-- ── households ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS households (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id     uuid        NOT NULL DEFAULT public.get_my_firm_id() REFERENCES firms(id) ON DELETE CASCADE,
  name        text        NOT NULL,
  adviser_id  uuid        REFERENCES advisers(id) ON DELETE SET NULL,
  is_active   boolean     NOT NULL DEFAULT true,
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS households_firm_idx ON households (firm_id);
CREATE INDEX IF NOT EXISTS households_adviser_idx ON households (adviser_id);

-- ── providers ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS providers (
  id                        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id                   uuid        NOT NULL DEFAULT public.get_my_firm_id() REFERENCES firms(id) ON DELETE CASCADE,
  name                      text        NOT NULL,
  provider_type             text        NOT NULL CHECK (provider_type IN
                              ('platform','insurer','annuity','investment_bond','direct_debit','client_direct','other')),
  -- Revenue month relative to the month received: -1 = the previous month
  -- (platforms pay September for August), 0 = the same month (insurers).
  generation_offset_months  int         NOT NULL DEFAULT 0 CHECK (generation_offset_months BETWEEN -12 AND 0),
  -- Saved column mapping for statement imports (lib/import/mapping.ts ImportMapping).
  import_mapping            jsonb,
  is_active                 boolean     NOT NULL DEFAULT true,
  created_at                timestamptz NOT NULL DEFAULT now(),
  UNIQUE (firm_id, name)
);

-- ── client_references ───────────────────────────────────────
-- Matching keys learnt from statements: an account/policy number
-- (kind='reference') or a client name as the provider prints it
-- (kind='name'), stored NORMALISED (lib/matching.ts). provider_id NULL =
-- applies to any provider.

CREATE TABLE IF NOT EXISTS client_references (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id       uuid        NOT NULL DEFAULT public.get_my_firm_id() REFERENCES firms(id) ON DELETE CASCADE,
  household_id  uuid        NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  provider_id   uuid        REFERENCES providers(id) ON DELETE CASCADE,
  kind          text        NOT NULL CHECK (kind IN ('reference','name')),
  reference     text        NOT NULL,
  label         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT client_references_unique UNIQUE NULLS NOT DISTINCT (firm_id, provider_id, kind, reference)
);
CREATE INDEX IF NOT EXISTS client_references_household_idx ON client_references (household_id);

-- ── statements ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS statements (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id               uuid        NOT NULL DEFAULT public.get_my_firm_id() REFERENCES firms(id) ON DELETE CASCADE,
  provider_id           uuid        NOT NULL REFERENCES providers(id) ON DELETE RESTRICT,
  source                text        NOT NULL DEFAULT 'upload' CHECK (source IN ('upload','manual')),
  received_date         date        NOT NULL,
  generation_month      date        NOT NULL CHECK (EXTRACT(DAY FROM generation_month) = 1),
  statement_ref         text,
  file_name             text,
  storage_path          text,
  -- What actually hit the bank (incl. GST), to reconcile against the lines.
  deposit_amount_cents  bigint,
  status                text        NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','finalised')),
  notes                 text,
  created_by            uuid        DEFAULT auth.uid() REFERENCES users(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS statements_firm_received_idx ON statements (firm_id, received_date);
CREATE INDEX IF NOT EXISTS statements_provider_idx ON statements (provider_id);

-- ── revenue_lines ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS revenue_lines (
  id                 uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id            uuid         NOT NULL DEFAULT public.get_my_firm_id() REFERENCES firms(id) ON DELETE CASCADE,
  statement_id       uuid         NOT NULL REFERENCES statements(id) ON DELETE CASCADE,
  -- Copied from the statement by trigger (reporting without a join).
  provider_id        uuid         NOT NULL REFERENCES providers(id) ON DELETE RESTRICT,
  received_date      date         NOT NULL,
  generation_month   date         NOT NULL CHECK (EXTRACT(DAY FROM generation_month) = 1),
  household_id       uuid         REFERENCES households(id) ON DELETE SET NULL,
  -- Snapshot of the household's adviser when matched, so moving a client to a
  -- new adviser never re-attributes revenue already paid out.
  adviser_id         uuid         REFERENCES advisers(id) ON DELETE SET NULL,
  match_status       text         NOT NULL DEFAULT 'unmatched' CHECK (match_status IN ('unmatched','auto','manual')),
  fee_type           text         CHECK (fee_type IN ('upfront','ongoing','one_off')),
  -- Snapshot of the adviser's share (percent) — set by trigger from fee type +
  -- adviser + firm settings; NULL until matched and classified.
  adviser_split_pct  numeric(5,2) CHECK (adviser_split_pct BETWEEN 0 AND 100),
  amount_cents       bigint       NOT NULL,
  gst_cents          bigint       NOT NULL DEFAULT 0,
  raw_client_name    text,
  raw_reference      text,
  raw_fee_type       text,
  product            text,
  description        text,
  row_number         int,
  raw                jsonb,
  created_at         timestamptz  NOT NULL DEFAULT now(),
  updated_at         timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS revenue_lines_statement_idx ON revenue_lines (statement_id);
CREATE INDEX IF NOT EXISTS revenue_lines_received_idx ON revenue_lines (firm_id, received_date);
CREATE INDEX IF NOT EXISTS revenue_lines_generation_idx ON revenue_lines (firm_id, generation_month);
CREATE INDEX IF NOT EXISTS revenue_lines_household_idx ON revenue_lines (household_id);
CREATE INDEX IF NOT EXISTS revenue_lines_adviser_idx ON revenue_lines (adviser_id);
CREATE INDEX IF NOT EXISTS revenue_lines_provider_idx ON revenue_lines (provider_id);

-- ── Triggers ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.households_before_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  PERFORM public.assert_in_firm('public.advisers', NEW.adviser_id, NEW.firm_id);
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS households_before_write ON households;
CREATE TRIGGER households_before_write BEFORE INSERT OR UPDATE ON households
  FOR EACH ROW EXECUTE FUNCTION public.households_before_write();

CREATE OR REPLACE FUNCTION public.client_references_before_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  PERFORM public.assert_in_firm('public.households', NEW.household_id, NEW.firm_id);
  PERFORM public.assert_in_firm('public.providers', NEW.provider_id, NEW.firm_id);
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS client_references_before_write ON client_references;
CREATE TRIGGER client_references_before_write BEFORE INSERT OR UPDATE ON client_references
  FOR EACH ROW EXECUTE FUNCTION public.client_references_before_write();

CREATE OR REPLACE FUNCTION public.statements_before_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  PERFORM public.assert_in_firm('public.providers', NEW.provider_id, NEW.firm_id);
  NEW.generation_month := date_trunc('month', NEW.generation_month)::date;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS statements_before_write ON statements;
CREATE TRIGGER statements_before_write BEFORE INSERT OR UPDATE ON statements
  FOR EACH ROW EXECUTE FUNCTION public.statements_before_write();

-- Keep lines in step with their statement: received date + provider always;
-- generation month only on lines still carrying the statement's old month
-- (a line given its own month — e.g. from a period column — keeps it).
CREATE OR REPLACE FUNCTION public.statements_after_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.generation_month IS DISTINCT FROM OLD.generation_month THEN
    UPDATE public.revenue_lines SET generation_month = NEW.generation_month
    WHERE statement_id = NEW.id AND generation_month = OLD.generation_month;
  END IF;
  IF NEW.received_date IS DISTINCT FROM OLD.received_date
     OR NEW.provider_id IS DISTINCT FROM OLD.provider_id THEN
    -- The line trigger re-derives both from the statement.
    UPDATE public.revenue_lines SET received_date = NEW.received_date WHERE statement_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS statements_after_update ON statements;
CREATE TRIGGER statements_after_update AFTER UPDATE ON statements
  FOR EACH ROW EXECUTE FUNCTION public.statements_after_update();

CREATE OR REPLACE FUNCTION public.revenue_lines_before_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  s record;
  h record;
  recompute boolean;
BEGIN
  SELECT firm_id, provider_id, received_date, generation_month INTO s
  FROM public.statements WHERE id = NEW.statement_id;
  IF NOT FOUND OR s.firm_id <> NEW.firm_id THEN
    RAISE EXCEPTION 'statement % does not belong to this firm', NEW.statement_id USING ERRCODE = '23503';
  END IF;
  NEW.provider_id := s.provider_id;
  NEW.received_date := s.received_date;
  NEW.generation_month := date_trunc('month', COALESCE(NEW.generation_month, s.generation_month))::date;

  -- Adviser follows the household unless this write sets it explicitly.
  IF NEW.household_id IS NOT NULL THEN
    SELECT firm_id, adviser_id INTO h FROM public.households WHERE id = NEW.household_id;
    IF NOT FOUND OR h.firm_id <> NEW.firm_id THEN
      RAISE EXCEPTION 'household % does not belong to this firm', NEW.household_id USING ERRCODE = '23503';
    END IF;
    IF TG_OP = 'INSERT' THEN
      NEW.adviser_id := COALESCE(NEW.adviser_id, h.adviser_id);
    ELSIF NEW.household_id IS DISTINCT FROM OLD.household_id
          AND NEW.adviser_id IS NOT DISTINCT FROM OLD.adviser_id THEN
      NEW.adviser_id := h.adviser_id;
    END IF;
    IF NEW.match_status = 'unmatched' THEN
      NEW.match_status := 'manual';
    END IF;
  ELSE
    IF TG_OP = 'UPDATE' AND OLD.household_id IS NOT NULL
       AND NEW.adviser_id IS NOT DISTINCT FROM OLD.adviser_id THEN
      NEW.adviser_id := NULL;
    END IF;
    NEW.match_status := 'unmatched';
  END IF;
  PERFORM public.assert_in_firm('public.advisers', NEW.adviser_id, NEW.firm_id);

  -- Adviser split snapshot. Recomputed when the fee type or adviser changes;
  -- otherwise the stored figure stands (a deliberate manual override survives).
  recompute := TG_OP = 'INSERT'
    OR NEW.fee_type IS DISTINCT FROM OLD.fee_type
    OR NEW.adviser_id IS DISTINCT FROM OLD.adviser_id;
  IF NEW.adviser_id IS NULL OR NEW.fee_type IS NULL THEN
    NEW.adviser_split_pct := NULL;
  ELSIF NEW.fee_type = 'ongoing' THEN
    NEW.adviser_split_pct := 0;
  ELSIF recompute THEN
    SELECT CASE NEW.fee_type
             WHEN 'upfront' THEN COALESCE(a.upfront_split_pct, fs.upfront_adviser_pct)
             ELSE fs.one_off_adviser_pct
           END
      INTO NEW.adviser_split_pct
    FROM public.firm_settings fs
    LEFT JOIN public.advisers a ON a.id = NEW.adviser_id
    WHERE fs.firm_id = NEW.firm_id;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS revenue_lines_before_write ON revenue_lines;
CREATE TRIGGER revenue_lines_before_write BEFORE INSERT OR UPDATE ON revenue_lines
  FOR EACH ROW EXECUTE FUNCTION public.revenue_lines_before_write();

-- ── Statement totals (RLS applies through security_invoker) ─

CREATE OR REPLACE VIEW statement_summaries WITH (security_invoker = true) AS
SELECT
  s.id                                                   AS statement_id,
  count(l.id)                                            AS line_count,
  COALESCE(sum(l.amount_cents), 0)                       AS amount_cents,
  COALESCE(sum(l.gst_cents), 0)                          AS gst_cents,
  count(l.id) FILTER (WHERE l.household_id IS NULL)      AS unmatched_count,
  count(l.id) FILTER (WHERE l.fee_type IS NULL)          AS unclassified_count
FROM statements s
LEFT JOIN revenue_lines l ON l.statement_id = s.id
GROUP BY s.id;

-- ── Row level security ──────────────────────────────────────
-- Every firm member reads their firm's rows. Day-to-day tables are writable
-- by any active member; the tables that decide who gets paid what
-- (firm_settings, advisers, shareholders) are writable by admins only.

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['households','providers','client_references','statements','revenue_lines'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_select', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_insert', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_update', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_delete', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR SELECT TO authenticated USING (firm_id = public.get_my_firm_id())', t || '_select', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR INSERT TO authenticated WITH CHECK (firm_id = public.get_my_firm_id())', t || '_insert', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR UPDATE TO authenticated USING (firm_id = public.get_my_firm_id()) WITH CHECK (firm_id = public.get_my_firm_id())', t || '_update', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR DELETE TO authenticated USING (firm_id = public.get_my_firm_id())', t || '_delete', t);
  END LOOP;

  FOREACH t IN ARRAY ARRAY['advisers','shareholders'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_select', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_write', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR SELECT TO authenticated USING (firm_id = public.get_my_firm_id())', t || '_select', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR ALL TO authenticated USING (firm_id = public.get_my_firm_id() AND public.is_firm_admin()) WITH CHECK (firm_id = public.get_my_firm_id() AND public.is_firm_admin())', t || '_write', t);
  END LOOP;
END $$;

ALTER TABLE firm_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS firm_settings_select ON firm_settings;
DROP POLICY IF EXISTS firm_settings_update ON firm_settings;
CREATE POLICY firm_settings_select ON firm_settings
  FOR SELECT TO authenticated USING (firm_id = public.get_my_firm_id());
CREATE POLICY firm_settings_update ON firm_settings
  FOR UPDATE TO authenticated
  USING (firm_id = public.get_my_firm_id() AND public.is_firm_admin())
  WITH CHECK (firm_id = public.get_my_firm_id() AND public.is_firm_admin());
REVOKE INSERT, DELETE ON firm_settings FROM authenticated, anon;

REVOKE ALL ON households, providers, client_references, statements, revenue_lines,
  advisers, shareholders, firm_settings, statement_summaries FROM anon;

-- ── Statement file storage ──────────────────────────────────
-- Original statements are kept for audit at {firm_id}/{statement_id}/{file}.

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('statements', 'statements', false, 20971520)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS statements_files_select ON storage.objects;
DROP POLICY IF EXISTS statements_files_insert ON storage.objects;
DROP POLICY IF EXISTS statements_files_delete ON storage.objects;
CREATE POLICY statements_files_select ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'statements' AND (storage.foldername(name))[1] = public.get_my_firm_id()::text);
CREATE POLICY statements_files_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'statements' AND (storage.foldername(name))[1] = public.get_my_firm_id()::text);
CREATE POLICY statements_files_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'statements' AND (storage.foldername(name))[1] = public.get_my_firm_id()::text);
