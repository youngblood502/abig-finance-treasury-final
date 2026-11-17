-- ABIG Finance - Phase 6 Task 3D: in-app notifications (the bell).
--
-- The bell shows the same events as the email notifications, to the same people, chosen by the same rules: outbox_recipients, which already
-- applies company scope, permissions and separation of duties (a creator is never asked to verify their own request, a reviewer who worked on a
-- week is not asked to lock it, people who lost access are left out, and out-of-date events go to nobody).
--
--   * user_notifications holds one row per person per event. A person reads, and marks as read, only their own rows: row-level security for
--     reading, and two functions for marking (the application role cannot update or delete the table directly). Rows are never deleted here, so
--     the history stays; each row keeps its own copy of what it says, so it survives if the outbox row is later removed.
--   * fan_out_notifications (worker) takes outbox events not yet handled (in_app_at is empty), skipping rows another run holds, and for the
--     actionable types adds a row for each recipient. (event, user) is unique, so a retry or an overlapping run cannot add a second copy.
--     Email delivery is not touched: no claim, lease, attempt, outcome or recipient record changes, and no outbox event is created.
--   * Actionable types only: things to verify, authenticate, review, enter, decide or fix, and the requester's own results. Company-wide or purely
--     informational events (an authenticated request to every Accountant, access granted or withdrawn, adjusted, cancelled, rescheduled, locked)
--     and the person's own sign-in events stay email only.
--   * Events created before this migration are marked handled, so nobody's bell fills with old items.

CREATE TABLE user_notifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id),
  event_id    uuid REFERENCES notification_outbox(id) ON DELETE SET NULL,
  event_type  text NOT NULL,
  request_id  uuid REFERENCES payment_requests(id),
  payload     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  read_at     timestamptz,
  UNIQUE (event_id, user_id)
);
CREATE INDEX user_notifications_user_idx ON user_notifications (user_id, created_at DESC);
CREATE INDEX user_notifications_unread_idx ON user_notifications (user_id) WHERE read_at IS NULL;
ALTER TABLE user_notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_notifications_own ON user_notifications FOR SELECT TO abig_app USING (user_id = app_user_id());
GRANT SELECT ON user_notifications TO abig_app;

ALTER TABLE notification_outbox ADD COLUMN in_app_at timestamptz;
UPDATE notification_outbox SET in_app_at = now();
CREATE INDEX notification_outbox_in_app_idx ON notification_outbox (created_at) WHERE in_app_at IS NULL;

-- The event types that reach the bell.
CREATE FUNCTION in_app_event(p_type text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT p_type IN ('REQUEST_SUBMITTED','REQUEST_RESTARTED','REQUEST_VERIFIED','REQUEST_RETURNED','REQUEST_REJECTED','REQUEST_OVERDUE','REQUEST_PAID',
                    'REQUEST_SCHEDULE_BLOCKED','ACCOUNT_SHORTFALL','ACCOUNT_OPENING_OVERDUE','RECONCILIATION_SUBMITTED','RECONCILIATION_RETURNED',
                    'SUPPLIER_BANK_DETAILS_PENDING','PERSON_DETAILS_PENDING') $$;

CREATE FUNCTION fan_out_notifications(p_limit integer DEFAULT 200) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE e notification_outbox; n int := 0; k int;
BEGIN
  FOR e IN SELECT * FROM notification_outbox WHERE in_app_at IS NULL ORDER BY created_at, id LIMIT least(greatest(coalesce(p_limit, 200), 1), 1000) FOR UPDATE SKIP LOCKED LOOP
    IF in_app_event(e.event_type) THEN
      INSERT INTO user_notifications (user_id, event_id, event_type, request_id, payload, created_at)
      SELECT r.user_id, e.id, e.event_type, e.request_id,
             COALESCE((SELECT jsonb_object_agg(kv.key, kv.value) FROM jsonb_each(e.payload) kv
                        WHERE kv.key IN ('request_no','reason','account_label','week_start','supplier_name','person_name','company_name','path','scheduled_for',
                                         'overdue_amount','balance','reserved','shortfall_amount')), '{}'::jsonb),
             e.created_at
        FROM outbox_recipients(e.id) r
      ON CONFLICT (event_id, user_id) DO NOTHING;
      GET DIAGNOSTICS k = ROW_COUNT; n := n + k;
    END IF;
    UPDATE notification_outbox SET in_app_at = now() WHERE id = e.id;
  END LOOP;
  RETURN n;
END $$;

-- Marking as read: only the person's own notifications. Returns how many changed (0 for someone else's or an already read one).
CREATE FUNCTION mark_notification_read(p_id uuid) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n int;
BEGIN
  IF app_user_id() IS NULL THEN RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501'; END IF;
  UPDATE user_notifications SET read_at = now() WHERE id = p_id AND user_id = app_user_id() AND read_at IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT; RETURN n;
END $$;
CREATE FUNCTION mark_all_notifications_read() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n int;
BEGIN
  IF app_user_id() IS NULL THEN RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501'; END IF;
  UPDATE user_notifications SET read_at = now() WHERE user_id = app_user_id() AND read_at IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT; RETURN n;
END $$;

REVOKE EXECUTE ON FUNCTION in_app_event(text), fan_out_notifications(integer), mark_notification_read(uuid), mark_all_notifications_read() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mark_notification_read(uuid), mark_all_notifications_read() TO abig_app;
GRANT EXECUTE ON FUNCTION fan_out_notifications(integer) TO abig_worker;
