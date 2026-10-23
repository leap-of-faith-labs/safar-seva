CREATE TABLE public.pulse_counts (
  metric text PRIMARY KEY CHECK (metric IN ('participants','observations','contributions','groups')),
  value bigint NOT NULL DEFAULT 0 CHECK (value >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.pulse_counts TO service_role;
ALTER TABLE public.pulse_counts ENABLE ROW LEVEL SECURITY;
INSERT INTO public.pulse_counts (metric, value) VALUES ('participants',148),('observations',92),('contributions',54),('groups',36);

CREATE OR REPLACE FUNCTION public.bump_pulse(p_metric text, p_n integer)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v bigint;
BEGIN
  IF p_n < 1 OR p_n > 5 THEN RAISE EXCEPTION 'invalid increment'; END IF;
  UPDATE public.pulse_counts SET value = value + p_n, updated_at = now() WHERE metric = p_metric RETURNING value INTO v;
  IF v IS NULL THEN RAISE EXCEPTION 'unknown metric'; END IF;
  RETURN v;
END $$;
REVOKE ALL ON FUNCTION public.bump_pulse(text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bump_pulse(text, integer) TO service_role;