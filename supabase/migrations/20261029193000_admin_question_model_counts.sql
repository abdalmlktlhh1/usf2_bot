CREATE OR REPLACE FUNCTION public.admin_question_model_counts()
RETURNS TABLE (
  course_id bigint,
  source_year integer,
  source_file text,
  total_count bigint,
  active_count bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
  SELECT
    q.course_id::bigint,
    COALESCE(q.source_year, 0)::integer,
    COALESCE(q.source_file, '')::text,
    COUNT(*)::bigint,
    COUNT(*) FILTER (WHERE COALESCE(q.is_active, false))::bigint
  FROM public.academic_questions AS q
  GROUP BY q.course_id, COALESCE(q.source_year, 0), COALESCE(q.source_file, '')
$function$;
REVOKE ALL ON FUNCTION public.admin_question_model_counts() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_question_model_counts() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_question_model_counts() TO service_role;
