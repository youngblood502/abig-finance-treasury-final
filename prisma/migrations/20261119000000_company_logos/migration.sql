-- Company logos: each company's own logo for its payment vouchers.
--
--   * The image is kept in private object storage under a random 64-hex key; this table holds only its description (type, size, SHA-256,
--     dimensions, who uploaded it and when). Image contents never enter the database or the audit log.
--   * History is kept: replacing or removing a logo ends the current row (ended_at, ended_by, end_reason) instead of deleting it.
--     At most one current logo per company.
--   * Only a system administrator sets or removes a logo, through admin_company_logo_set / admin_company_logo_remove. The app role can read
--     the rows of companies it can already see (the same rows as companies_read) and cannot write the table at all.
--   * Existing companies, permissions and policies are unchanged.

CREATE TABLE company_logos (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id),
  object_key  text NOT NULL UNIQUE CHECK (object_key ~ '^[0-9a-f]{64}$'),
  mime_type   text NOT NULL CHECK (mime_type IN ('image/png', 'image/jpeg')),
  size_bytes  integer NOT NULL CHECK (size_bytes BETWEEN 1 AND 1048576),
  sha256      text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  width       integer NOT NULL CHECK (width BETWEEN 64 AND 2000),
  height      integer NOT NULL CHECK (height BETWEEN 64 AND 2000),
  uploaded_by uuid NOT NULL REFERENCES users(id),
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  ended_at    timestamptz,
  ended_by    uuid REFERENCES users(id),
  end_reason  text CHECK (end_reason IN ('REPLACED', 'REMOVED')),
  CONSTRAINT company_logos_end_chk CHECK ((ended_at IS NULL AND ended_by IS NULL AND end_reason IS NULL) OR (ended_at IS NOT NULL AND ended_by IS NOT NULL AND end_reason IS NOT NULL))
);
CREATE UNIQUE INDEX company_logos_one_current ON company_logos (company_id) WHERE ended_at IS NULL;
CREATE INDEX company_logos_company_idx ON company_logos (company_id, uploaded_at DESC);

-- A logo's description never changes and is never deleted; the only change is ending the current row, once.
CREATE FUNCTION company_logos_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'company logo history cannot be deleted' USING ERRCODE = '42501'; END IF;
  IF OLD.ended_at IS NOT NULL THEN RAISE EXCEPTION 'a replaced or removed company logo cannot be changed' USING ERRCODE = '42501'; END IF;
  IF (NEW.id, NEW.company_id, NEW.object_key, NEW.mime_type, NEW.size_bytes, NEW.sha256, NEW.width, NEW.height, NEW.uploaded_by, NEW.uploaded_at)
     IS DISTINCT FROM (OLD.id, OLD.company_id, OLD.object_key, OLD.mime_type, OLD.size_bytes, OLD.sha256, OLD.width, OLD.height, OLD.uploaded_by, OLD.uploaded_at) THEN
    RAISE EXCEPTION 'a company logo''s file details cannot be changed; upload a new logo instead' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER company_logos_guard BEFORE UPDATE OR DELETE ON company_logos FOR EACH ROW EXECUTE FUNCTION company_logos_guard();

ALTER TABLE company_logos ENABLE ROW LEVEL SECURITY;
-- Exactly the companies this person can already see (companies_read applies inside the subquery): whoever sees a company's name on a
-- voucher sees its logo, and nobody else.
CREATE POLICY company_logos_read ON company_logos FOR SELECT TO abig_app USING (company_id IN (SELECT id FROM companies));
GRANT SELECT ON company_logos TO abig_app;

-- Sets (uploads or replaces) a company's logo. The caller has already validated the file and is about to store it under p_key in the same
-- transaction; if storing fails the transaction rolls back and this row never exists.
CREATE FUNCTION admin_company_logo_set(p_company uuid, p_key text, p_mime text, p_size integer, p_sha256 text, p_width integer, p_height integer)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id uuid; o company_logos;
BEGIN
  IF NOT app_is_admin() THEN RAISE EXCEPTION 'only a system administrator can change a company logo' USING ERRCODE = '42501'; END IF;
  PERFORM 1 FROM companies WHERE id = p_company FOR UPDATE;   -- one logo change at a time per company
  IF NOT FOUND THEN RAISE EXCEPTION 'company not found' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO o FROM company_logos WHERE company_id = p_company AND ended_at IS NULL;
  IF FOUND THEN
    UPDATE company_logos SET ended_at = now(), ended_by = app_user_id(), end_reason = 'REPLACED' WHERE id = o.id;
  END IF;
  INSERT INTO company_logos (company_id, object_key, mime_type, size_bytes, sha256, width, height, uploaded_by)
  VALUES (p_company, p_key, p_mime, p_size, lower(p_sha256), p_width, p_height, app_user_id()) RETURNING id INTO v_id;
  PERFORM treasury_audit(p_company, CASE WHEN o.id IS NULL THEN 'COMPANY_LOGO_UPLOADED' ELSE 'COMPANY_LOGO_REPLACED' END, 'COMPANY_LOGO', v_id,
    jsonb_build_object('previous_sha256', o.sha256, 'new_sha256', lower(p_sha256), 'mime_type', p_mime, 'size_bytes', p_size, 'width', p_width, 'height', p_height, 'previous_logo_id', o.id));
  RETURN v_id;
END $$;

-- Removes a company's current logo; its vouchers then show the company code. The history row and the stored file are kept.
CREATE FUNCTION admin_company_logo_remove(p_company uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE o company_logos;
BEGIN
  IF NOT app_is_admin() THEN RAISE EXCEPTION 'only a system administrator can change a company logo' USING ERRCODE = '42501'; END IF;
  PERFORM 1 FROM companies WHERE id = p_company FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'company not found' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO o FROM company_logos WHERE company_id = p_company AND ended_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'this company has no logo to remove' USING ERRCODE = 'P0002'; END IF;
  UPDATE company_logos SET ended_at = now(), ended_by = app_user_id(), end_reason = 'REMOVED' WHERE id = o.id;
  PERFORM treasury_audit(p_company, 'COMPANY_LOGO_REMOVED', 'COMPANY_LOGO', o.id, jsonb_build_object('previous_sha256', o.sha256));
END $$;

REVOKE EXECUTE ON FUNCTION company_logos_guard(), admin_company_logo_set(uuid, text, text, integer, text, integer, integer), admin_company_logo_remove(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_company_logo_set(uuid, text, text, integer, text, integer, integer), admin_company_logo_remove(uuid) TO abig_app;
