-- ABIG Finance - Treasury Phase 1: the two new payment statuses.
-- On its own because PostgreSQL cannot use a new enum value in the transaction that added it; the next migration relies on them.
ALTER TYPE payment_request_status ADD VALUE IF NOT EXISTS 'PAID' AFTER 'AUTHENTICATED';
ALTER TYPE payment_request_status ADD VALUE IF NOT EXISTS 'CANCELLED' AFTER 'REJECTED';
