-- ============================================================
-- 006_month_close.sql
-- Month-end close. Advisers and shareholders are paid at the start of each
-- month for the money RECEIVED the month before, so a received month is
-- "closed" once those payouts are settled:
--
--   providers.statement_frequency  how often statements arrive — drives the
--                                  "missing statement" check on the close page
--   month_closes                   one row per close, with a frozen snapshot of
--                                  the payout figures; reopening keeps the row
--                                  (reopened_at/by/reason) as the audit trail
--   close_month / reopen_month     admin-only RPCs
--   *_month_lock triggers          refuse any change to a closed month that
--                                  would alter what was paid: amounts, GST,
--                                  fee type, dates, provider, deposit, deleting
--                                  — and the adviser/split on upfront and
--                                  one-off lines. Matching a household (or the
--                                  adviser on an ONGOING line, which pays the
--                                  adviser nothing) stays allowed.
-- ============================================================

ALTER TABLE providers
  ADD COLUMN IF NOT EXISTS statement_frequency text NOT NULL DEFAULT 'monthly'
    CHECK (statement_frequency IN ('weekly','fortnightly','monthly','quarterly','irregular'));

UPDATE providers SET statement_frequency = 'irregular'
WHERE provider_type = 'client_direct' AND statement_frequency = 'monthly';

-- ── month_closes ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS month_closes (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id        uuid        NOT NULL DEFAULT public.get_my_firm_id() REFERENCES firms(id) ON DELETE CASCADE,
  -- The RECEIVED month, as its 1st.
  month          date        NOT NULL CHECK (EXTRACT(DAY FROM month) = 1),
  closed_at      timestamptz NOT NULL DEFAULT now(),
  closed_by      uuid        DEFAULT auth.uid() REFERENCES users(id) ON DELETE SET NULL,
  notes          text,
  -- The figures as paid (lib/month-close.ts CloseSnapshot).
  snapshot       jsonb       NOT NULL,
  reopened_at    timestamptz,
  reopened_by    uuid        REFERENCES users(id) ON DELETE SET NULL,
  reopen_reason  text,
  CHECK ((reopened_at IS NULL) = (reopen_reason IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS month_closes_open_unique ON month_closes (firm_id, month) WHERE reopened_at IS NULL;
CREATE INDEX IF NOT EXISTS month_closes_firm_month_idx ON month_closes (firm_id, month);

ALTER TABLE month_closes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS month_closes_select ON month_closes;
CREATE POLICY month_closes_select ON month_closes FOR SELECT TO authenticated USING (firm_id = public.get_my_firm_id());
-- Writes only through close_month / reopen_month.
REVOKE INSERT, UPDATE, DELETE ON month_closes FROM authenticated;
REVOKE ALL ON month_closes FROM anon;

-- Is the received month containing p_date closed for firm p_firm? Runs as the
-- caller, so it can only ever see the caller's own firm's closes.
CREATE OR REPLACE FUNCTION public.month_is_closed(p_firm uuid, p_date date)
RETURNS boolean
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT p_date IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.month_closes
    WHERE firm_id = p_firm AND month = date_trunc('month', p_date)::date AND reopened_at IS NULL
  )
$$;
REVOKE EXECUTE ON FUNCTION public.month_is_closed(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.month_is_closed(uuid, date) TO authenticated;

CREATE OR REPLACE FUNCTION public.raise_month_closed(p_date date)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION '% is closed — reopen it on the Month-end page to change it', to_char(p_date, 'FMMonth YYYY')
    USING ERRCODE = 'P0001', HINT = 'month_closed';
END;
$$;

-- ── Lock triggers ───────────────────────────────────────────
-- pg_trigger_depth() > 1 = a change cascading from another trigger or FK
-- action (e.g. a statement's dates flowing to its lines, a firm being
-- deleted) — the originating change is the one that's checked.

CREATE OR REPLACE FUNCTION public.statements_month_lock()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP IN ('UPDATE','DELETE') AND public.month_is_closed(OLD.firm_id, OLD.received_date) THEN
    IF TG_OP = 'DELETE'
       OR NEW.received_date IS DISTINCT FROM OLD.received_date
       OR NEW.generation_month IS DISTINCT FROM OLD.generation_month
       OR NEW.provider_id IS DISTINCT FROM OLD.provider_id
       OR NEW.deposit_amount_cents IS DISTINCT FROM OLD.deposit_amount_cents
       OR NEW.status IS DISTINCT FROM OLD.status THEN
      PERFORM public.raise_month_closed(OLD.received_date);
    END IF;
  END IF;
  IF TG_OP IN ('INSERT','UPDATE') AND public.month_is_closed(NEW.firm_id, NEW.received_date)
     AND (TG_OP = 'INSERT' OR NEW.received_date IS DISTINCT FROM OLD.received_date) THEN
    PERFORM public.raise_month_closed(NEW.received_date);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;
DROP TRIGGER IF EXISTS statements_month_lock ON statements;
CREATE TRIGGER statements_month_lock BEFORE INSERT OR UPDATE OR DELETE ON statements
  FOR EACH ROW EXECUTE FUNCTION public.statements_month_lock();

-- Named to sort AFTER revenue_lines_before_write, so it sees the derived
-- received_date / adviser / split.
CREATE OR REPLACE FUNCTION public.revenue_lines_month_lock()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP IN ('UPDATE','DELETE') AND public.month_is_closed(OLD.firm_id, OLD.received_date) THEN
    IF TG_OP = 'DELETE'
       OR NEW.statement_id IS DISTINCT FROM OLD.statement_id
       OR NEW.received_date IS DISTINCT FROM OLD.received_date
       OR NEW.generation_month IS DISTINCT FROM OLD.generation_month
       OR NEW.amount_cents IS DISTINCT FROM OLD.amount_cents
       OR NEW.gst_cents IS DISTINCT FROM OLD.gst_cents
       OR NEW.fee_type IS DISTINCT FROM OLD.fee_type
       OR (OLD.fee_type IS DISTINCT FROM 'ongoing' AND (
             NEW.adviser_id IS DISTINCT FROM OLD.adviser_id
             OR NEW.adviser_split_pct IS DISTINCT FROM OLD.adviser_split_pct)) THEN
      PERFORM public.raise_month_closed(OLD.received_date);
    END IF;
  END IF;
  IF TG_OP = 'INSERT' AND public.month_is_closed(NEW.firm_id, NEW.received_date) THEN
    PERFORM public.raise_month_closed(NEW.received_date);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;
DROP TRIGGER IF EXISTS revenue_lines_month_lock ON revenue_lines;
CREATE TRIGGER revenue_lines_month_lock BEFORE INSERT OR UPDATE OR DELETE ON revenue_lines
  FOR EACH ROW EXECUTE FUNCTION public.revenue_lines_month_lock();

-- ── RPCs ────────────────────────────────────────────────────

-- Close a received month: re-checks the hard blockers server-side, finalises
-- the month's statements and stores the snapshot. SECURITY DEFINER because
-- authenticated users have no direct write on month_closes — every query here
-- is scoped to the caller's firm, and only an admin gets past the first check.
CREATE OR REPLACE FUNCTION public.close_month(p_month date, p_snapshot jsonb, p_notes text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_firm uuid := public.get_my_firm_id();
  v_from date := date_trunc('month', p_month)::date;
  v_to   date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
  v_unclassified int;
  v_no_adviser int;
  v_id uuid;
BEGIN
  IF v_firm IS NULL OR NOT public.is_firm_admin() THEN
    RAISE EXCEPTION 'Only an admin can close a month' USING ERRCODE = '42501';
  END IF;
  IF public.month_is_closed(v_firm, v_from) THEN
    RAISE EXCEPTION '% is already closed', to_char(v_from, 'FMMonth YYYY');
  END IF;
  SELECT count(*) FILTER (WHERE fee_type IS NULL),
         count(*) FILTER (WHERE fee_type IN ('upfront','one_off') AND adviser_id IS NULL)
    INTO v_unclassified, v_no_adviser
  FROM public.revenue_lines
  WHERE firm_id = v_firm AND received_date BETWEEN v_from AND v_to;
  IF v_unclassified > 0 OR v_no_adviser > 0 THEN
    RAISE EXCEPTION 'Can''t close %: % line(s) without a fee type, % upfront/one-off line(s) without an adviser',
      to_char(v_from, 'FMMonth YYYY'), v_unclassified, v_no_adviser;
  END IF;

  UPDATE public.statements SET status = 'finalised'
  WHERE firm_id = v_firm AND received_date BETWEEN v_from AND v_to AND status <> 'finalised';

  INSERT INTO public.month_closes (firm_id, month, closed_by, notes, snapshot)
  VALUES (v_firm, v_from, auth.uid(), NULLIF(trim(p_notes), ''), p_snapshot)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.close_month(date, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.close_month(date, jsonb, text) TO authenticated;

-- Reopen a closed month (admin, with a reason). The close row stays as history.
CREATE OR REPLACE FUNCTION public.reopen_month(p_month date, p_reason text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_firm uuid := public.get_my_firm_id();
BEGIN
  IF v_firm IS NULL OR NOT public.is_firm_admin() THEN
    RAISE EXCEPTION 'Only an admin can reopen a month' USING ERRCODE = '42501';
  END IF;
  IF NULLIF(trim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'Give a reason for reopening';
  END IF;
  UPDATE public.month_closes
     SET reopened_at = now(), reopened_by = auth.uid(), reopen_reason = trim(p_reason)
   WHERE firm_id = v_firm AND month = date_trunc('month', p_month)::date AND reopened_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION '% is not closed', to_char(p_month, 'FMMonth YYYY');
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.reopen_month(date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reopen_month(date, text) TO authenticated;
