-- ABIG Finance - A third kind of payee: a one-time payee entered on the request itself.
-- On its own because PostgreSQL cannot use a new enum value in the transaction that added it; the next migration relies on it.
ALTER TYPE payee_type ADD VALUE IF NOT EXISTS 'ONE_TIME';
