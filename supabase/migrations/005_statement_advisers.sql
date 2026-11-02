-- ============================================================
-- 005_statement_advisers.sql
-- Provider statements name the adviser on every line (insurers: "Adviser
-- number" + "Adviser name"). That is the adviser who is paid for the
-- business, so it takes precedence over the household's adviser.
--
--   adviser_references         learnt provider adviser codes/names → adviser
--   revenue_lines.raw_adviser_code / raw_adviser_name   as printed
--   revenue_lines.adviser_source  'statement' | 'household' | 'manual'
--
-- Trigger change: matching (or re-matching) a household only fills the
-- adviser when the line's adviser came from a household (or it has none) —
-- a statement or manually chosen adviser survives.
-- ============================================================

CREATE TABLE IF NOT EXISTS adviser_references (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id      uuid        NOT NULL DEFAULT public.get_my_firm_id() REFERENCES firms(id) ON DELETE CASCADE,
  adviser_id   uuid        NOT NULL REFERENCES advisers(id) ON DELETE CASCADE,
  provider_id  uuid        REFERENCES providers(id) ON DELETE CASCADE,
  kind         text        NOT NULL CHECK (kind IN ('code','name')),
  -- normalised: codes via normaliseRef, names via normaliseName (lib/matching.ts)
  reference    text        NOT NULL,
  label        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT adviser_references_unique UNIQUE NULLS NOT DISTINCT (firm_id, provider_id, kind, reference)
);
CREATE INDEX IF NOT EXISTS adviser_references_adviser_idx ON adviser_references (adviser_id);

CREATE OR REPLACE FUNCTION public.adviser_references_before_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  PERFORM public.assert_in_firm('public.advisers', NEW.adviser_id, NEW.firm_id);
  PERFORM public.assert_in_firm('public.providers', NEW.provider_id, NEW.firm_id);
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS adviser_references_before_write ON adviser_references;
CREATE TRIGGER adviser_references_before_write BEFORE INSERT OR UPDATE ON adviser_references
  FOR EACH ROW EXECUTE FUNCTION public.adviser_references_before_write();

ALTER TABLE adviser_references ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS adviser_references_select ON adviser_references;
DROP POLICY IF EXISTS adviser_references_insert ON adviser_references;
DROP POLICY IF EXISTS adviser_references_update ON adviser_references;
DROP POLICY IF EXISTS adviser_references_delete ON adviser_references;
CREATE POLICY adviser_references_select ON adviser_references FOR SELECT TO authenticated USING (firm_id = public.get_my_firm_id());
CREATE POLICY adviser_references_insert ON adviser_references FOR INSERT TO authenticated WITH CHECK (firm_id = public.get_my_firm_id());
CREATE POLICY adviser_references_update ON adviser_references FOR UPDATE TO authenticated USING (firm_id = public.get_my_firm_id()) WITH CHECK (firm_id = public.get_my_firm_id());
CREATE POLICY adviser_references_delete ON adviser_references FOR DELETE TO authenticated USING (firm_id = public.get_my_firm_id());
REVOKE ALL ON adviser_references FROM anon;

ALTER TABLE revenue_lines
  ADD COLUMN IF NOT EXISTS raw_adviser_code text,
  ADD COLUMN IF NOT EXISTS raw_adviser_name text,
  ADD COLUMN IF NOT EXISTS adviser_source   text CHECK (adviser_source IN ('statement','household','manual'));

CREATE OR REPLACE FUNCTION public.revenue_lines_before_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  s record;
  h record;
  recompute boolean;
  explicit_adviser boolean;
BEGIN
  SELECT firm_id, provider_id, received_date, generation_month INTO s
  FROM public.statements WHERE id = NEW.statement_id;
  IF NOT FOUND OR s.firm_id <> NEW.firm_id THEN
    RAISE EXCEPTION 'statement % does not belong to this firm', NEW.statement_id USING ERRCODE = '23503';
  END IF;
  NEW.provider_id := s.provider_id;
  NEW.received_date := s.received_date;
  NEW.generation_month := date_trunc('month', COALESCE(NEW.generation_month, s.generation_month))::date;

  -- Where the adviser came from. An adviser set in this write keeps the
  -- source the write gave it (default 'manual').
  explicit_adviser := TG_OP = 'UPDATE' AND NEW.adviser_id IS DISTINCT FROM OLD.adviser_id;
  IF TG_OP = 'INSERT' THEN
    NEW.adviser_source := CASE WHEN NEW.adviser_id IS NULL THEN NULL ELSE COALESCE(NEW.adviser_source, 'manual') END;
  ELSIF explicit_adviser THEN
    NEW.adviser_source := CASE
      WHEN NEW.adviser_id IS NULL THEN NULL
      WHEN NEW.adviser_source IS DISTINCT FROM OLD.adviser_source THEN COALESCE(NEW.adviser_source, 'manual')
      ELSE 'manual'
    END;
  END IF;

  IF NEW.household_id IS NOT NULL THEN
    SELECT firm_id, adviser_id INTO h FROM public.households WHERE id = NEW.household_id;
    IF NOT FOUND OR h.firm_id <> NEW.firm_id THEN
      RAISE EXCEPTION 'household % does not belong to this firm', NEW.household_id USING ERRCODE = '23503';
    END IF;
    -- The household supplies the adviser only when nothing better is known.
    IF (TG_OP = 'INSERT' AND NEW.adviser_id IS NULL)
       OR (TG_OP = 'UPDATE' AND NOT explicit_adviser
           AND NEW.household_id IS DISTINCT FROM OLD.household_id
           AND COALESCE(NEW.adviser_source, 'household') = 'household') THEN
      NEW.adviser_id := h.adviser_id;
      NEW.adviser_source := CASE WHEN h.adviser_id IS NULL THEN NULL ELSE 'household' END;
    END IF;
    IF NEW.match_status = 'unmatched' THEN
      NEW.match_status := 'manual';
    END IF;
  ELSE
    IF TG_OP = 'UPDATE' AND OLD.household_id IS NOT NULL AND NOT explicit_adviser
       AND NEW.adviser_source = 'household' THEN
      NEW.adviser_id := NULL;
      NEW.adviser_source := NULL;
    END IF;
    NEW.match_status := 'unmatched';
  END IF;
  PERFORM public.assert_in_firm('public.advisers', NEW.adviser_id, NEW.firm_id);

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

-- Existing lines got their adviser from the household.
UPDATE revenue_lines SET adviser_source = 'household'
WHERE adviser_id IS NOT NULL AND adviser_source IS NULL;
