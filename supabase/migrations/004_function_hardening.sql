-- ============================================================
-- 004_function_hardening.sql
-- Advisor fixes: signed-out callers can't execute the RLS helpers, and the
-- unused set_updated_at() gets a fixed search_path. Signed-in users keep
-- EXECUTE on get_my_firm_id()/is_firm_admin() deliberately — every RLS
-- policy calls them, and they only reveal the caller's own firm/role.
-- ============================================================

REVOKE EXECUTE ON FUNCTION public.get_my_firm_id() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_firm_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_firm_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_firm_admin() TO authenticated;

ALTER FUNCTION public.set_updated_at() SET search_path = public;
