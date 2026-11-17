-- ABIG Finance - Phase 2: suppliers, versioned bank details, payment requests, installments, attachments.
-- Policy defaults used (blueprint section 2): group-wide supplier identity, company-specific status/terms, ETB only.

CREATE SEQUENCE payment_request_seq;

CREATE TABLE suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_name text NOT NULL,
  tin text NOT NULL UNIQUE CHECK (tin ~ '^[0-9A-Za-z-]{6,20}$'), -- Finance to confirm the exact TIN format
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Every change to beneficiary bank details is a new version that must be verified by someone other than its creator.
CREATE TABLE supplier_bank_details (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id uuid NOT NULL REFERENCES suppliers(id),
  version int NOT NULL,
  bank_name text NOT NULL,
  account_last4 char(4) NOT NULL,
  account_number_enc bytea,
  currency char(3) NOT NULL DEFAULT 'ETB' CHECK (currency = 'ETB'),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','VERIFIED','REJECTED','SUPERSEDED')),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  verified_by uuid REFERENCES users(id),
  verified_at timestamptz,
  rejection_reason text,
  UNIQUE (supplier_id, version)
);
CREATE UNIQUE INDEX supplier_bank_one_verified ON supplier_bank_details (supplier_id) WHERE status = 'VERIFIED';

CREATE TABLE company_suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  supplier_id uuid NOT NULL REFERENCES suppliers(id),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE','BLOCKED')),
  payment_terms_days int NOT NULL DEFAULT 30 CHECK (payment_terms_days >= 0),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, supplier_id)
);

CREATE TABLE payment_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_no text NOT NULL UNIQUE DEFAULT ('PR-' || lpad(nextval('payment_request_seq')::text, 6, '0')),
  debtor_company_id uuid NOT NULL REFERENCES companies(id),
  supplier_id uuid NOT NULL REFERENCES suppliers(id),
  supplier_bank_detail_id uuid REFERENCES supplier_bank_details(id),
  created_by uuid NOT NULL REFERENCES users(id),
  currency char(3) NOT NULL DEFAULT 'ETB' CHECK (currency = 'ETB'),
  priority text NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('LOW','NORMAL','HIGH','URGENT')),
  invoice_ref text,
  invoice_date date,
  description text,
  total_amount numeric(19,4) NOT NULL CHECK (total_amount > 0),
  workflow_state text NOT NULL DEFAULT 'DRAFT'
    CHECK (workflow_state IN ('DRAFT','SUBMITTED','VERIFIED','AUTHORIZED','RETURNED','REJECTED','CANCELLED')),
  version int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- The same supplier invoice cannot be in play twice (drafts, cancelled and rejected requests do not count).
CREATE UNIQUE INDEX payment_requests_invoice_once ON payment_requests (supplier_id, lower(invoice_ref))
  WHERE invoice_ref IS NOT NULL AND workflow_state NOT IN ('DRAFT','CANCELLED','REJECTED');
CREATE INDEX payment_requests_company_state_idx ON payment_requests (debtor_company_id, workflow_state);

CREATE TABLE payment_installments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES payment_requests(id),
  seq int NOT NULL CHECK (seq > 0),
  due_date date NOT NULL,
  amount numeric(19,4) NOT NULL CHECK (amount > 0),
  currency char(3) NOT NULL DEFAULT 'ETB' CHECK (currency = 'ETB'),
  UNIQUE (request_id, seq)
);

CREATE TABLE attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES payment_requests(id),
  kind text NOT NULL CHECK (kind IN ('INVOICE','SUPPORTING')),
  object_key text NOT NULL UNIQUE CHECK (length(object_key) >= 32), -- random key in private storage, never the filename
  filename text NOT NULL,
  mime_type text NOT NULL CHECK (mime_type IN ('application/pdf','image/png','image/jpeg')),
  size_bytes bigint NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 10485760),
  sha256 char(64) NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  supersedes_id uuid REFERENCES attachments(id),
  uploaded_by uuid NOT NULL REFERENCES users(id),
  uploaded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX attachments_request_idx ON attachments (request_id);

CREATE TABLE request_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES payment_requests(id),
  from_state text,
  to_state text NOT NULL,
  actor_id uuid,
  version int NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX request_events_request_idx ON request_events (request_id, occurred_at);

-- ---------- Helpers (SECURITY DEFINER, so policies cannot recurse) ----------
CREATE FUNCTION app_is_member_anywhere() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$ SELECT EXISTS (SELECT 1 FROM app_readable_companies()) $$;

CREATE FUNCTION app_has_role_anywhere(p_role text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$ SELECT EXISTS (SELECT 1 FROM app_member_companies(p_role)) $$;

CREATE FUNCTION app_supplier_active_for(p_company uuid, p_supplier uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$ SELECT EXISTS (SELECT 1 FROM company_suppliers cs JOIN suppliers s ON s.id = cs.supplier_id
                     WHERE cs.company_id = p_company AND cs.supplier_id = p_supplier AND cs.status = 'ACTIVE' AND s.is_active) $$;

-- Drafts are private to their creator; submitted requests are visible to the debtor company (and its group reporters).
CREATE FUNCTION app_can_see_request(p_request uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$ SELECT EXISTS (SELECT 1 FROM payment_requests r WHERE r.id = p_request
                       AND r.debtor_company_id IN (SELECT app_readable_companies())
                       AND (r.workflow_state <> 'DRAFT' OR r.created_by = app_user_id())) $$;

CREATE FUNCTION app_can_edit_draft(p_request uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$ SELECT EXISTS (SELECT 1 FROM payment_requests r WHERE r.id = p_request AND r.workflow_state = 'DRAFT' AND r.created_by = app_user_id()
                       AND r.debtor_company_id IN (SELECT app_member_companies('INPUTTER'))) $$;

-- ---------- Triggers ----------
CREATE FUNCTION bank_detail_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.version := COALESCE((SELECT max(version) FROM supplier_bank_details WHERE supplier_id = NEW.supplier_id), 0) + 1;
    NEW.status := 'PENDING'; NEW.verified_by := NULL; NEW.verified_at := NULL; NEW.rejection_reason := NULL;
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - 'status' - 'verified_by' - 'verified_at' - 'rejection_reason') IS DISTINCT FROM
     (to_jsonb(OLD) - 'status' - 'verified_by' - 'verified_at' - 'rejection_reason') THEN
    RAISE EXCEPTION 'bank details cannot be edited; add a new version' USING ERRCODE = '42501';
  END IF;
  IF OLD.status = 'VERIFIED' AND NEW.status = 'SUPERSEDED' AND pg_trigger_depth() > 1 THEN RETURN NEW; END IF;
  IF OLD.status <> 'PENDING' OR NEW.status NOT IN ('VERIFIED','REJECTED') THEN
    RAISE EXCEPTION 'only a pending bank detail can be verified or rejected' USING ERRCODE = '42501';
  END IF;
  NEW.verified_by := COALESCE(app_user_id(), NEW.verified_by); NEW.verified_at := now();
  IF NEW.verified_by IS NULL OR NEW.verified_by = OLD.created_by THEN
    RAISE EXCEPTION 'bank details must be checked by someone other than the person who entered them' USING ERRCODE = '42501';
  END IF;
  IF NEW.status = 'REJECTED' AND coalesce(NEW.rejection_reason, '') = '' THEN
    RAISE EXCEPTION 'a rejection needs a reason' USING ERRCODE = '23514';
  END IF;
  IF NEW.status = 'VERIFIED' THEN
    UPDATE supplier_bank_details SET status = 'SUPERSEDED' WHERE supplier_id = NEW.supplier_id AND status = 'VERIFIED';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER supplier_bank_details_guard BEFORE INSERT OR UPDATE ON supplier_bank_details FOR EACH ROW EXECUTE FUNCTION bank_detail_guard();
CREATE TRIGGER supplier_bank_details_no_delete BEFORE DELETE ON supplier_bank_details FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE FUNCTION payment_request_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n int; s numeric;
BEGIN
  IF TG_OP = 'INSERT' THEN NEW.version := 1; NEW.updated_at := now(); RETURN NEW; END IF;
  IF NEW.created_by <> OLD.created_by OR NEW.debtor_company_id <> OLD.debtor_company_id
     OR NEW.currency <> OLD.currency OR NEW.request_no <> OLD.request_no THEN
    RAISE EXCEPTION 'creator, debtor company, currency and number cannot change' USING ERRCODE = '42501';
  END IF;
  IF OLD.workflow_state <> 'DRAFT' THEN RAISE EXCEPTION 'the request is locked after submission' USING ERRCODE = '42501'; END IF;
  IF NEW.workflow_state NOT IN ('DRAFT','SUBMITTED','CANCELLED') THEN
    RAISE EXCEPTION 'a draft can only be saved, submitted or cancelled' USING ERRCODE = '42501';
  END IF;
  IF NEW.workflow_state = 'SUBMITTED' THEN
    SELECT count(*), COALESCE(sum(amount), 0) INTO n, s FROM payment_installments WHERE request_id = NEW.id;
    IF n = 0 THEN RAISE EXCEPTION 'at least one installment is required' USING ERRCODE = '23514'; END IF;
    IF s <> NEW.total_amount THEN RAISE EXCEPTION 'installments (%) must add up to the request total (%)', s, NEW.total_amount USING ERRCODE = '23514'; END IF;
    IF NEW.invoice_ref IS NULL OR NEW.invoice_date IS NULL THEN RAISE EXCEPTION 'invoice reference and date are required' USING ERRCODE = '23514'; END IF;
    IF NOT EXISTS (SELECT 1 FROM supplier_bank_details WHERE id = NEW.supplier_bank_detail_id AND supplier_id = NEW.supplier_id AND status = 'VERIFIED') THEN
      RAISE EXCEPTION 'verified supplier bank details are required' USING ERRCODE = '23514';
    END IF;
    IF NOT app_supplier_active_for(NEW.debtor_company_id, NEW.supplier_id) THEN
      RAISE EXCEPTION 'the supplier is not active for this company' USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM attachments a WHERE a.request_id = NEW.id AND a.kind = 'INVOICE'
                   AND NOT EXISTS (SELECT 1 FROM attachments b WHERE b.supersedes_id = a.id)) THEN
      RAISE EXCEPTION 'an invoice attachment is required' USING ERRCODE = '23514';
    END IF;
  END IF;
  NEW.version := OLD.version + 1; NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER payment_requests_guard BEFORE INSERT OR UPDATE ON payment_requests FOR EACH ROW EXECUTE FUNCTION payment_request_guard();
CREATE TRIGGER payment_requests_no_delete BEFORE DELETE ON payment_requests FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE FUNCTION payment_request_events_fn() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO request_events (request_id, from_state, to_state, actor_id, version) VALUES (NEW.id, NULL, NEW.workflow_state, app_user_id(), NEW.version);
  ELSIF NEW.workflow_state <> OLD.workflow_state THEN
    INSERT INTO request_events (request_id, from_state, to_state, actor_id, version) VALUES (NEW.id, OLD.workflow_state, NEW.workflow_state, app_user_id(), NEW.version);
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER payment_requests_events AFTER INSERT OR UPDATE ON payment_requests FOR EACH ROW EXECUTE FUNCTION payment_request_events_fn();

CREATE FUNCTION installment_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE st text; cur char(3); rid uuid;
BEGIN
  rid := CASE WHEN TG_OP = 'DELETE' THEN OLD.request_id ELSE NEW.request_id END;
  SELECT workflow_state, currency INTO st, cur FROM payment_requests WHERE id = rid;
  IF st IS DISTINCT FROM 'DRAFT' THEN RAISE EXCEPTION 'installments are locked after submission' USING ERRCODE = '42501'; END IF;
  IF TG_OP <> 'DELETE' AND NEW.currency <> cur THEN RAISE EXCEPTION 'installment currency must match the request' USING ERRCODE = '23514'; END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER installments_guard BEFORE INSERT OR UPDATE OR DELETE ON payment_installments FOR EACH ROW EXECUTE FUNCTION installment_guard();

CREATE FUNCTION attachment_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF (SELECT workflow_state FROM payment_requests WHERE id = NEW.request_id) IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION 'attachments can only be added to a draft; use a controlled replacement after submission' USING ERRCODE = '42501';
  END IF;
  IF NEW.supersedes_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM attachments WHERE id = NEW.supersedes_id AND request_id = NEW.request_id) THEN
    RAISE EXCEPTION 'a replacement must belong to the same request' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER attachments_guard BEFORE INSERT ON attachments FOR EACH ROW EXECUTE FUNCTION attachment_guard();
CREATE TRIGGER attachments_append_only BEFORE UPDATE OR DELETE ON attachments FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER attachments_no_truncate BEFORE TRUNCATE ON attachments FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER request_events_append_only BEFORE UPDATE OR DELETE ON request_events FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER request_events_no_truncate BEFORE TRUNCATE ON request_events FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();

-- ---------- Row-level security ----------
ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_bank_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_installments ENABLE ROW LEVEL SECURITY;
ALTER TABLE attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE request_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY suppliers_read ON suppliers FOR SELECT TO abig_app USING (app_is_member_anywhere());
CREATE POLICY suppliers_insert ON suppliers FOR INSERT TO abig_app WITH CHECK (app_has_role_anywhere('INPUTTER') AND created_by = app_user_id());

CREATE POLICY bank_read ON supplier_bank_details FOR SELECT TO abig_app USING (app_is_member_anywhere());
CREATE POLICY bank_insert ON supplier_bank_details FOR INSERT TO abig_app WITH CHECK (app_has_role_anywhere('INPUTTER') AND created_by = app_user_id());
CREATE POLICY bank_verify ON supplier_bank_details FOR UPDATE TO abig_app USING (app_has_role_anywhere('VERIFIER')) WITH CHECK (app_has_role_anywhere('VERIFIER'));

CREATE POLICY company_suppliers_read ON company_suppliers FOR SELECT TO abig_app USING (company_id IN (SELECT app_readable_companies()));
CREATE POLICY company_suppliers_insert ON company_suppliers FOR INSERT TO abig_app
  WITH CHECK (created_by = app_user_id() AND (company_id IN (SELECT app_member_companies('INPUTTER')) OR company_id IN (SELECT app_member_companies('FINANCE_MANAGER'))));
CREATE POLICY company_suppliers_update ON company_suppliers FOR UPDATE TO abig_app
  USING (company_id IN (SELECT app_member_companies('FINANCE_MANAGER'))) WITH CHECK (company_id IN (SELECT app_member_companies('FINANCE_MANAGER')));

CREATE POLICY requests_read ON payment_requests FOR SELECT TO abig_app
  USING (debtor_company_id IN (SELECT app_readable_companies()) AND (workflow_state <> 'DRAFT' OR created_by = app_user_id()));
CREATE POLICY requests_insert ON payment_requests FOR INSERT TO abig_app
  WITH CHECK (debtor_company_id IN (SELECT app_member_companies('INPUTTER')) AND created_by = app_user_id()
              AND workflow_state = 'DRAFT' AND app_supplier_active_for(debtor_company_id, supplier_id));
CREATE POLICY requests_update_draft ON payment_requests FOR UPDATE TO abig_app
  USING (created_by = app_user_id() AND workflow_state = 'DRAFT' AND debtor_company_id IN (SELECT app_member_companies('INPUTTER')))
  WITH CHECK (created_by = app_user_id());

CREATE POLICY installments_read ON payment_installments FOR SELECT TO abig_app USING (app_can_see_request(request_id));
CREATE POLICY installments_insert ON payment_installments FOR INSERT TO abig_app WITH CHECK (app_can_edit_draft(request_id));
CREATE POLICY installments_update ON payment_installments FOR UPDATE TO abig_app USING (app_can_edit_draft(request_id)) WITH CHECK (app_can_edit_draft(request_id));
CREATE POLICY installments_delete ON payment_installments FOR DELETE TO abig_app USING (app_can_edit_draft(request_id));

CREATE POLICY attachments_read ON attachments FOR SELECT TO abig_app USING (app_can_see_request(request_id));
CREATE POLICY attachments_insert ON attachments FOR INSERT TO abig_app WITH CHECK (uploaded_by = app_user_id() AND app_can_edit_draft(request_id));

CREATE POLICY request_events_read ON request_events FOR SELECT TO abig_app USING (app_can_see_request(request_id));

-- ---------- Privileges ----------
GRANT USAGE ON SEQUENCE payment_request_seq TO abig_app;
GRANT SELECT ON suppliers, company_suppliers, payment_requests, payment_installments, attachments, request_events TO abig_app;
GRANT SELECT (id, supplier_id, version, bank_name, account_last4, currency, status, created_by, created_at, verified_by, verified_at, rejection_reason)
  ON supplier_bank_details TO abig_app; -- never account_number_enc
GRANT INSERT ON suppliers, company_suppliers, payment_installments, attachments TO abig_app;
GRANT INSERT (supplier_id, bank_name, account_last4, account_number_enc, created_by) ON supplier_bank_details TO abig_app;
GRANT UPDATE (status, verified_by, rejection_reason) ON supplier_bank_details TO abig_app;
GRANT UPDATE (status, payment_terms_days) ON company_suppliers TO abig_app;
GRANT INSERT (debtor_company_id, supplier_id, supplier_bank_detail_id, created_by, priority, invoice_ref, invoice_date, description, total_amount)
  ON payment_requests TO abig_app;
GRANT UPDATE (supplier_id, supplier_bank_detail_id, priority, invoice_ref, invoice_date, description, total_amount, workflow_state) ON payment_requests TO abig_app;
GRANT UPDATE (due_date, amount) ON payment_installments TO abig_app;
GRANT DELETE ON payment_installments TO abig_app;
