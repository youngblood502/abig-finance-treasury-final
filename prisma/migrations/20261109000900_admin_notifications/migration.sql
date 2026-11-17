-- ABIG Finance - Notification monitoring for system administrators: counts, a filtered list with each event's recipients, and sending a failed
-- (DEAD) or unanswered (NO_RECIPIENTS) notification again.
--
-- The application role still has no access to notification_outbox or notification_deliveries. Everything goes through the three functions below,
-- each of which refuses anyone who is not an active system administrator.
--
-- Sending again (approved rules):
--   * Only DEAD and NO_RECIPIENTS events. Open events are already queued; DELIVERED ones have nothing left to send.
--   * The event is reopened with attempts reset to 0, so it gets the usual 8 attempts and backoff.
--   * Recipient records are kept: anyone already SENT is skipped by the worker, so nobody is emailed twice. Recipients are worked out again when it
--     is sent, so a role assigned since then is reached, and an event that has since become out of date still goes to nobody.
--   * Every retry is audited as ADMIN_NOTIFICATION_RETRIED with what it replaced (outcome, attempts, last error, when it failed), which the reset clears.
-- Nothing about delivery (claims, leases, retries, recipients) changes.

CREATE INDEX notification_outbox_outcome_created_idx ON notification_outbox (outcome, created_at DESC);

-- How the screen names a state: an outcome, or for an open event whether it is retrying after a failure or waiting for its first try.
CREATE FUNCTION notification_status(o notification_outbox) RETURNS text LANGUAGE sql IMMUTABLE
AS $$ SELECT COALESCE(o.outcome, CASE WHEN o.attempts > 0 AND o.last_error IS NOT NULL THEN 'RETRYING' ELSE 'WAITING' END) $$;

CREATE FUNCTION admin_notification_summary() RETURNS TABLE (waiting int, due int, retrying int, dead int, no_recipients int, delivered_24h int, oldest_waiting timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT app_is_admin() THEN RAISE EXCEPTION 'only a system administrator can see notifications' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
  SELECT count(*) FILTER (WHERE o.outcome IS NULL)::int,
         count(*) FILTER (WHERE o.outcome IS NULL AND o.available_at <= now())::int,
         count(*) FILTER (WHERE notification_status(o) = 'RETRYING')::int,
         count(*) FILTER (WHERE o.outcome = 'DEAD')::int,
         count(*) FILTER (WHERE o.outcome = 'NO_RECIPIENTS')::int,
         count(*) FILTER (WHERE o.outcome = 'DELIVERED' AND o.delivered_at > now() - interval '24 hours')::int,
         min(o.created_at) FILTER (WHERE o.outcome IS NULL)
    FROM notification_outbox o;
END $$;

-- The newest events matching the filters, at most 200. Only the payload fields the screen names an event by are returned, never the whole payload.
-- p_status: WAITING, RETRYING, DEAD, NO_RECIPIENTS, DELIVERED, or OPEN (waiting or retrying). p_q matches the event type, the request number,
-- the names in the payload and recipient email addresses. Dates are Addis Ababa days of creation.
CREATE FUNCTION admin_notification_list(p_status text DEFAULT NULL, p_type text DEFAULT NULL, p_q text DEFAULT NULL, p_from date DEFAULT NULL, p_to date DEFAULT NULL, p_limit integer DEFAULT 200)
RETURNS TABLE (id uuid, event_type text, request_id uuid, request_no text, account_label text, week_start text, supplier_name text, person_name text, company_name text,
               created_at timestamptz, available_at timestamptz, attempts int, status text, delivered_at timestamptz, dead_at timestamptz, last_error text, deliveries jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE q text := NULLIF(btrim(coalesce(p_q, '')), '');
BEGIN
  IF NOT app_is_admin() THEN RAISE EXCEPTION 'only a system administrator can see notifications' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
  SELECT o.id, o.event_type, o.request_id, o.payload->>'request_no', o.payload->>'account_label', o.payload->>'week_start', o.payload->>'supplier_name',
         o.payload->>'person_name', o.payload->>'company_name', o.created_at, o.available_at, o.attempts, notification_status(o), o.delivered_at, o.dead_at, o.last_error,
         COALESCE((SELECT jsonb_agg(jsonb_build_object('email', d.email, 'status', d.status, 'attempts', d.attempts, 'sent_at', d.sent_at, 'last_error', d.last_error) ORDER BY d.email)
                     FROM notification_deliveries d WHERE d.event_id = o.id), '[]'::jsonb)
    FROM notification_outbox o
   WHERE (p_status IS NULL OR notification_status(o) = p_status OR (p_status = 'OPEN' AND o.outcome IS NULL))
     AND (p_type IS NULL OR o.event_type = p_type)
     AND (p_from IS NULL OR (o.created_at AT TIME ZONE 'Africa/Addis_Ababa')::date >= p_from)
     AND (p_to IS NULL OR (o.created_at AT TIME ZONE 'Africa/Addis_Ababa')::date <= p_to)
     AND (q IS NULL OR o.event_type ILIKE '%' || q || '%' OR o.payload->>'request_no' ILIKE '%' || q || '%' OR o.payload->>'account_label' ILIKE '%' || q || '%'
          OR o.payload->>'supplier_name' ILIKE '%' || q || '%' OR o.payload->>'person_name' ILIKE '%' || q || '%' OR o.payload->>'company_name' ILIKE '%' || q || '%'
          OR EXISTS (SELECT 1 FROM notification_deliveries d WHERE d.event_id = o.id AND d.email ILIKE '%' || q || '%'))
   ORDER BY o.created_at DESC, o.id
   LIMIT least(greatest(coalesce(p_limit, 200), 1), 200);
END $$;

CREATE FUNCTION admin_notification_retry(p_id uuid) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE o notification_outbox;
BEGIN
  IF NOT app_is_admin() THEN RAISE EXCEPTION 'only a system administrator can send a notification again' USING ERRCODE = '42501'; END IF;
  SELECT * INTO o FROM notification_outbox WHERE notification_outbox.id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'notification not found' USING ERRCODE = 'P0002'; END IF;
  IF o.outcome IS DISTINCT FROM 'DEAD' AND o.outcome IS DISTINCT FROM 'NO_RECIPIENTS' THEN
    RAISE EXCEPTION 'only a notification that failed or found nobody to send to can be sent again' USING ERRCODE = '23514';
  END IF;
  UPDATE notification_outbox SET outcome = NULL, dead_at = NULL, delivered_at = NULL, lease_token = NULL, attempts = 0, last_error = NULL, available_at = now()
   WHERE notification_outbox.id = p_id;
  PERFORM treasury_audit(NULL, 'ADMIN_NOTIFICATION_RETRIED', 'NOTIFICATION', p_id,
    jsonb_build_object('event_type', o.event_type, 'previous_outcome', o.outcome, 'attempts', o.attempts, 'last_error', o.last_error, 'dead_at', o.dead_at, 'created_at', o.created_at));
  RETURN 'QUEUED';
END $$;

REVOKE EXECUTE ON FUNCTION notification_status(notification_outbox), admin_notification_summary(), admin_notification_list(text, text, text, date, date, integer), admin_notification_retry(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_notification_summary(), admin_notification_list(text, text, text, date, date, integer), admin_notification_retry(uuid) TO abig_app;
