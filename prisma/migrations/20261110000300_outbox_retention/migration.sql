-- ABIG Finance - Phase 6 Task 4 (part 1): outbox retention.
--
-- Delivered email events, and their recipient delivery records, are kept for 6 months after delivery and then removed by the worker.
--
-- Eligible (outbox_purgeable), all of:
--   * outcome = 'DELIVERED' and delivered_at is earlier than the cutoff (outbox_retention_cutoff: the treasury clock minus 6 months);
--   * no worker holds it (lease_token is empty);
--   * the in-app bell has already taken its copy (in_app_at is set).
-- Never removed automatically: open events (waiting or retrying), DEAD events and NO_RECIPIENTS events. The last two are unresolved and an
-- administrator can still send them again.
--
-- What goes with it, and what stays:
--   * notification_deliveries rows go with their event (ON DELETE CASCADE), so the recipient records also live 6 months.
--   * user_notifications stay: each keeps its own copy of what it says, and its event reference is cleared (ON DELETE SET NULL).
--   * audit_events are not touched (they reference events by id only). Each run that removes anything is itself audited as NOTIFICATIONS_PURGED.
--   * De-duplication is unaffected: the overdue-opening reminder is unique per account and current week, the overdue-request reminder looks back
--     24 hours, and the scheduled-payment notice is recorded on the request; none of them reaches back 6 months.
--   * Email delivery is unchanged: only finished events are removed, and the claim, lease and retry functions are not touched.
-- purge_outbox runs in batches, skips rows another run holds (SKIP LOCKED), and re-checks eligibility on the locked row.

CREATE INDEX notification_outbox_delivered_idx ON notification_outbox (delivered_at) WHERE outcome = 'DELIVERED';

CREATE FUNCTION outbox_retention_cutoff() RETURNS timestamptz LANGUAGE sql STABLE AS $$ SELECT treasury_now() - interval '6 months' $$;

CREATE FUNCTION outbox_purgeable(o notification_outbox, p_cutoff timestamptz) RETURNS boolean LANGUAGE sql IMMUTABLE
AS $$ SELECT o.outcome = 'DELIVERED' AND o.delivered_at IS NOT NULL AND o.delivered_at < p_cutoff AND o.lease_token IS NULL AND o.in_app_at IS NOT NULL $$;

CREATE FUNCTION purge_outbox(p_batch integer DEFAULT 500, p_max_batches integer DEFAULT 20) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE cutoff timestamptz := outbox_retention_cutoff(); size int := least(greatest(coalesce(p_batch, 500), 1), 5000); n int := 0; k int; i int := 0;
BEGIN
  LOOP
    WITH c AS (SELECT o.id FROM notification_outbox o
                WHERE o.outcome = 'DELIVERED' AND o.delivered_at < cutoff AND outbox_purgeable(o, cutoff)
                ORDER BY o.delivered_at, o.id LIMIT size FOR UPDATE SKIP LOCKED)
    DELETE FROM notification_outbox o USING c WHERE o.id = c.id AND outbox_purgeable(o, cutoff);
    GET DIAGNOSTICS k = ROW_COUNT;
    n := n + k; i := i + 1;
    EXIT WHEN k < size OR i >= least(greatest(coalesce(p_max_batches, 20), 1), 100);
  END LOOP;
  IF n > 0 THEN
    INSERT INTO audit_events (actor_id, company_id, action, entity_type, entity_id, metadata)
    VALUES (app_system_user(), NULL, 'NOTIFICATIONS_PURGED', 'NOTIFICATION', NULL, jsonb_build_object('removed', n, 'delivered_before', cutoff));
  END IF;
  RETURN n;
END $$;

REVOKE EXECUTE ON FUNCTION outbox_retention_cutoff(), outbox_purgeable(notification_outbox, timestamptz), purge_outbox(integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION purge_outbox(integer, integer) TO abig_worker;
