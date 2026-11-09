-- ABIG Finance - Notification delivery: no repeated emails after a partial failure, no double sending after a lease runs out, and a visible outcome
-- for notifications that nobody could receive.
--
-- Before this migration:
--   * One outbox event was sent to all its recipients in a loop and marked done only at the end. If the third recipient failed, the whole event was
--     retried, and the first two received the email again.
--   * A claim was a five-minute lease (available_at). A worker still sending after five minutes could find another worker sending the same event,
--     and either worker's late outbox_complete/outbox_fail overwrote the other's result.
--   * An event whose recipient list was empty was marked delivered.
--
-- What changes (event types, recipient rules, the retry limit of 8 attempts and the backoff of 2^attempts minutes up to 60 stay as they are):
--   1. Each claim gets a new lease_token. Only the holder of the current token can record anything for the event, so a worker whose lease ran out and
--      was claimed again is told it has lost the event (LOST) and stops. The lease is renewed before every recipient, so it only has to outlast one send.
--   2. notification_deliveries keeps one row per event and recipient. A recipient whose email was sent (SENT) is skipped on every later attempt.
--      Before sending, the worker marks the recipient SENDING under its token; another worker meeting that mark is told BUSY and retries later,
--      unless the mark is older than 15 minutes (the sender is taken to have crashed).
--   3. notification_outbox.outcome records how an event ended: DELIVERED (at least one recipient was sent the email), NO_RECIPIENTS (nobody could be
--      resolved; not retried, delivered_at stays empty) or DEAD (gave up after 8 attempts). An open event has no outcome.
-- The outbox is a delivery queue, not history: no audit event, request or financial record is touched.

ALTER TABLE notification_outbox ADD COLUMN outcome text CHECK (outcome IN ('DELIVERED', 'NO_RECIPIENTS', 'DEAD')), ADD COLUMN lease_token uuid;
-- Existing rows keep what they recorded. Events that went to nobody before this migration were marked delivered and cannot be told apart.
UPDATE notification_outbox SET outcome = CASE WHEN delivered_at IS NOT NULL THEN 'DELIVERED' ELSE 'DEAD' END WHERE delivered_at IS NOT NULL OR dead_at IS NOT NULL;
DROP INDEX notification_outbox_pending_idx;
CREATE INDEX notification_outbox_pending_idx ON notification_outbox (available_at) WHERE outcome IS NULL;

CREATE TABLE notification_deliveries (
  event_id    uuid NOT NULL REFERENCES notification_outbox(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id),
  email       text NOT NULL,
  status      text NOT NULL CHECK (status IN ('PENDING', 'SENDING', 'SENT', 'FAILED')),
  attempts    integer NOT NULL DEFAULT 0,
  lease_token uuid,
  started_at  timestamptz,
  sent_at     timestamptz,
  last_error  text,
  PRIMARY KEY (event_id, user_id),
  CHECK ((status = 'SENT') = (sent_at IS NOT NULL))
);
-- Only the worker functions below touch it; neither the application nor the worker role has table access.
ALTER TABLE notification_deliveries ENABLE ROW LEVEL SECURITY;

-- Claims up to p_limit open events whose lease has run out (or that were never claimed). SKIP LOCKED keeps concurrent workers apart; the new token
-- makes every earlier claim of the same event stale.
CREATE OR REPLACE FUNCTION outbox_claim(p_limit integer DEFAULT 20) RETURNS SETOF notification_outbox LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  WITH c AS (SELECT id FROM notification_outbox WHERE outcome IS NULL AND available_at <= now()
             ORDER BY created_at LIMIT p_limit FOR UPDATE SKIP LOCKED)
  UPDATE notification_outbox o SET attempts = o.attempts + 1, available_at = now() + interval '5 minutes', lease_token = gen_random_uuid()
  FROM c WHERE o.id = c.id RETURNING o.* $$;

-- Before emailing one recipient. SEND: go ahead (the recipient is now SENDING under this token and the lease is renewed). SKIP: already sent.
-- BUSY: another attempt is sending to this recipient right now. LOST: this worker no longer holds the event; stop.
CREATE FUNCTION outbox_begin_delivery(p_event uuid, p_token uuid, p_user uuid, p_email text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE e notification_outbox; d notification_deliveries;
BEGIN
  SELECT * INTO e FROM notification_outbox WHERE id = p_event FOR UPDATE;
  IF NOT FOUND OR e.outcome IS NOT NULL OR p_token IS NULL OR e.lease_token IS DISTINCT FROM p_token THEN RETURN 'LOST'; END IF;
  UPDATE notification_outbox SET available_at = greatest(available_at, now() + interval '5 minutes') WHERE id = p_event;
  INSERT INTO notification_deliveries (event_id, user_id, email, status) VALUES (p_event, p_user, p_email, 'PENDING') ON CONFLICT DO NOTHING;
  SELECT * INTO d FROM notification_deliveries WHERE event_id = p_event AND user_id = p_user FOR UPDATE;
  IF d.status = 'SENT' THEN RETURN 'SKIP'; END IF;
  IF d.status = 'SENDING' AND d.lease_token IS DISTINCT FROM p_token AND d.started_at > now() - interval '15 minutes' THEN RETURN 'BUSY'; END IF;
  UPDATE notification_deliveries SET status = 'SENDING', email = p_email, lease_token = p_token, started_at = now(), attempts = attempts + 1, last_error = NULL
   WHERE event_id = p_event AND user_id = p_user;
  RETURN 'SEND';
END $$;

-- After emailing one recipient: p_error NULL means sent. Recorded only while the recipient is still SENDING under this token, so a send that
-- succeeds after its lease was lost still stops the next worker from sending it again, unless that worker already took the recipient over.
CREATE FUNCTION outbox_record_delivery(p_event uuid, p_token uuid, p_user uuid, p_error text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE notification_deliveries
     SET status = CASE WHEN p_error IS NULL THEN 'SENT' ELSE 'FAILED' END, sent_at = CASE WHEN p_error IS NULL THEN now() END,
         last_error = CASE WHEN p_error IS NULL THEN NULL ELSE left(p_error, 500) END
   WHERE event_id = p_event AND user_id = p_user AND status = 'SENDING' AND lease_token = p_token;
  RETURN FOUND;
END $$;

-- Every resolved recipient was sent the email (now or earlier). DELIVERED when anyone was, NO_RECIPIENTS when nobody could be resolved.
CREATE FUNCTION outbox_finish(p_event uuid, p_token uuid) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE e notification_outbox;
BEGIN
  SELECT * INTO e FROM notification_outbox WHERE id = p_event FOR UPDATE;
  IF NOT FOUND OR e.outcome IS NOT NULL OR p_token IS NULL OR e.lease_token IS DISTINCT FROM p_token THEN RETURN 'LOST'; END IF;
  IF EXISTS (SELECT 1 FROM notification_deliveries WHERE event_id = p_event AND status = 'SENT') THEN
    UPDATE notification_outbox SET outcome = 'DELIVERED', delivered_at = now(), last_error = NULL, lease_token = NULL WHERE id = p_event;
    RETURN 'DELIVERED';
  END IF;
  UPDATE notification_outbox SET outcome = 'NO_RECIPIENTS', last_error = 'no recipients', lease_token = NULL WHERE id = p_event;
  RETURN 'NO_RECIPIENTS';
END $$;

-- Some recipient failed (or was busy): try again later with the same backoff and limit as before. RETRY or DEAD, or LOST for a stale token.
DROP FUNCTION outbox_complete(uuid);
DROP FUNCTION outbox_fail(uuid, text);
CREATE FUNCTION outbox_fail(p_event uuid, p_token uuid, p_error text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE e notification_outbox;
BEGIN
  SELECT * INTO e FROM notification_outbox WHERE id = p_event FOR UPDATE;
  IF NOT FOUND OR e.outcome IS NOT NULL OR p_token IS NULL OR e.lease_token IS DISTINCT FROM p_token THEN RETURN 'LOST'; END IF;
  UPDATE notification_outbox SET last_error = left(p_error, 500), lease_token = NULL,
         available_at = now() + least(power(2, e.attempts), 60) * interval '1 minute',
         dead_at = CASE WHEN e.attempts >= 8 THEN now() END, outcome = CASE WHEN e.attempts >= 8 THEN 'DEAD' END
   WHERE id = p_event;
  RETURN CASE WHEN e.attempts >= 8 THEN 'DEAD' ELSE 'RETRY' END;
END $$;

REVOKE EXECUTE ON FUNCTION outbox_begin_delivery(uuid, uuid, uuid, text), outbox_record_delivery(uuid, uuid, uuid, text), outbox_finish(uuid, uuid), outbox_fail(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION outbox_begin_delivery(uuid, uuid, uuid, text), outbox_record_delivery(uuid, uuid, uuid, text), outbox_finish(uuid, uuid), outbox_fail(uuid, uuid, text) TO abig_worker;
