-- ABIG Finance - Email settings a system administrator can manage.
--
-- Until now the mail server came only from the worker's environment (SMTP_URL, MAIL_FROM). This adds one central place for it, read by both the
-- website (the "Send a test email" button) and the background worker (every notification):
--
--   * email_settings holds at most one row. While it is empty, nothing changes: the worker keeps using SMTP_URL and MAIL_FROM.
--   * The SMTP password is encrypted by the application (AES-256-GCM, the same "v1:" format and APP_ENCRYPTION_KEY as the two-step secrets) before
--     it reaches the database. The database never sees the plain password and has no key; it only refuses a value that is not in that format.
--   * No role has any privilege on the table. Everything goes through the functions below:
--       admin_email_settings()        what the screen shows: every field except the password, and whether a password is saved
--       admin_save_email_settings()   validates and saves; a NULL password keeps the saved one
--       admin_clear_email_settings()  removes the saved settings, so the environment is used again
--       admin_email_transport()       the settings with the ENCRYPTED password, for the server to send a test email
--       admin_record_email_test()     writes the result of a test email to the audit trail
--       worker_email_settings()       the same for the worker role, which has no person behind it
--     The admin_* functions refuse anyone who is not an active system administrator. worker_email_settings() can be run by abig_worker only.
--   * Saving, clearing and testing are audited. The audit entry says which fields changed and whether the password was set, changed or removed;
--     it never contains the password, in any form.
--   * A password is never sent over a connection that is not encrypted: with a user name, the connection must be TLS or STARTTLS.
-- The outbox, its claims, leases, retries and recipients are not touched.

CREATE TABLE email_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),          -- one row at most
  smtp_host text NOT NULL CHECK (smtp_host ~ '^[A-Za-z0-9]([A-Za-z0-9.:-]{0,251}[A-Za-z0-9])?$'),
  smtp_port integer NOT NULL CHECK (smtp_port BETWEEN 1 AND 65535),
  smtp_username text CHECK (smtp_username IS NULL OR (length(smtp_username) BETWEEN 1 AND 320 AND smtp_username !~ '[[:cntrl:]]')),
  smtp_password_enc text CHECK (smtp_password_enc IS NULL OR smtp_password_enc ~ '^v1:[A-Za-z0-9+/]{38,}={0,2}$'),   -- 12-byte IV, 16-byte tag, the ciphertext
  security text NOT NULL CHECK (security IN ('TLS', 'STARTTLS', 'NONE')),
  tls_verify boolean NOT NULL DEFAULT true,
  sender_name text NOT NULL CHECK (length(sender_name) BETWEEN 1 AND 100 AND sender_name !~ '[[:cntrl:]<>"]'),
  sender_email text NOT NULL CHECK (sender_email = lower(sender_email) AND sender_email ~ '^[^[:space:]@<>]+@[^[:space:]@<>]+\.[^[:space:]@<>]+$' AND length(sender_email) <= 254),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL REFERENCES users(id),
  CONSTRAINT email_settings_login_chk CHECK ((smtp_username IS NULL) = (smtp_password_enc IS NULL)),
  CONSTRAINT email_settings_password_needs_tls CHECK (smtp_password_enc IS NULL OR security <> 'NONE')
);
ALTER TABLE email_settings ENABLE ROW LEVEL SECURITY;      -- and no policy: only the owner, through the functions below
REVOKE ALL ON email_settings FROM PUBLIC;

CREATE FUNCTION admin_email_settings() RETURNS TABLE (smtp_host text, smtp_port integer, smtp_username text, password_set boolean, security text, tls_verify boolean,
                                                      sender_name text, sender_email text, updated_at timestamptz, updated_by_name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT app_is_admin() THEN RAISE EXCEPTION 'only a system administrator can see the email settings' USING ERRCODE = '42501'; END IF;
  RETURN QUERY SELECT s.smtp_host, s.smtp_port, s.smtp_username, s.smtp_password_enc IS NOT NULL, s.security, s.tls_verify, s.sender_name, s.sender_email, s.updated_at, u.full_name
                 FROM email_settings s JOIN users u ON u.id = s.updated_by;
END $$;

-- p_password_enc: the new password, already encrypted by the application; NULL keeps the saved one. Without a user name there is no password.
CREATE FUNCTION admin_save_email_settings(p_host text, p_port integer, p_username text, p_password_enc text, p_security text, p_tls_verify boolean, p_sender_name text, p_sender_email text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  o email_settings; had boolean;
  v_host text := lower(btrim(coalesce(p_host, '')));
  v_user text := NULLIF(btrim(coalesce(p_username, '')), '');
  v_security text := upper(btrim(coalesce(p_security, '')));
  v_name text := regexp_replace(btrim(coalesce(p_sender_name, '')), '\s+', ' ', 'g');
  v_from text := lower(btrim(coalesce(p_sender_email, '')));
  v_verify boolean := coalesce(p_tls_verify, true);
  v_pass text; v_password text; changes jsonb := '{}'::jsonb;
BEGIN
  IF NOT app_is_admin() THEN RAISE EXCEPTION 'only a system administrator can change the email settings' USING ERRCODE = '42501'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('email_settings', 0));
  SELECT * INTO o FROM email_settings; had := FOUND;

  IF v_host = '' THEN RAISE EXCEPTION 'the SMTP host is required' USING ERRCODE = '23514'; END IF;
  IF v_host !~ '^[a-z0-9]([a-z0-9.:-]{0,251}[a-z0-9])?$' THEN RAISE EXCEPTION 'enter the SMTP host as a server name or address, for example smtp.example.com' USING ERRCODE = '23514'; END IF;
  IF p_port IS NULL OR p_port NOT BETWEEN 1 AND 65535 THEN RAISE EXCEPTION 'the SMTP port must be a number from 1 to 65535' USING ERRCODE = '23514'; END IF;
  IF v_security NOT IN ('TLS', 'STARTTLS', 'NONE') THEN RAISE EXCEPTION 'choose how the connection is secured' USING ERRCODE = '23514'; END IF;
  IF v_user IS NOT NULL AND (length(v_user) > 320 OR v_user ~ '[[:cntrl:]]') THEN RAISE EXCEPTION 'the SMTP user name is not valid' USING ERRCODE = '23514'; END IF;
  IF v_name = '' THEN RAISE EXCEPTION 'the sender name is required' USING ERRCODE = '23514'; END IF;
  IF length(v_name) > 100 OR v_name ~ '[[:cntrl:]<>"]' THEN RAISE EXCEPTION 'the sender name is too long or has characters an email program would refuse' USING ERRCODE = '23514'; END IF;
  IF v_from = '' THEN RAISE EXCEPTION 'the sender email address is required' USING ERRCODE = '23514'; END IF;
  IF v_from !~ '^[^[:space:]@<>]+@[^[:space:]@<>]+\.[^[:space:]@<>]+$' OR length(v_from) > 254 THEN RAISE EXCEPTION 'enter a valid sender email address' USING ERRCODE = '23514'; END IF;
  IF p_password_enc IS NOT NULL AND p_password_enc !~ '^v1:[A-Za-z0-9+/]{38,}={0,2}$' THEN RAISE EXCEPTION 'the SMTP password must be encrypted before it is saved' USING ERRCODE = '23514'; END IF;

  v_pass := CASE WHEN v_user IS NULL THEN NULL ELSE coalesce(p_password_enc, o.smtp_password_enc) END;
  IF v_user IS NULL AND p_password_enc IS NOT NULL THEN RAISE EXCEPTION 'a password needs an SMTP user name' USING ERRCODE = '23514'; END IF;
  IF v_user IS NOT NULL AND v_pass IS NULL THEN RAISE EXCEPTION 'enter the SMTP password for that user name' USING ERRCODE = '23514'; END IF;
  IF v_pass IS NOT NULL AND v_security = 'NONE' THEN RAISE EXCEPTION 'a password cannot be sent over an unencrypted connection; choose TLS or STARTTLS' USING ERRCODE = '23514'; END IF;

  -- What changed, for the audit trail. The password appears only as a word.
  IF NOT had OR o.smtp_host <> v_host THEN changes := changes || jsonb_build_object('smtp_host', jsonb_build_array(o.smtp_host, v_host)); END IF;
  IF NOT had OR o.smtp_port <> p_port THEN changes := changes || jsonb_build_object('smtp_port', jsonb_build_array(o.smtp_port, p_port)); END IF;
  IF NOT had OR o.smtp_username IS DISTINCT FROM v_user THEN changes := changes || jsonb_build_object('smtp_username', jsonb_build_array(o.smtp_username, v_user)); END IF;
  IF NOT had OR o.security <> v_security THEN changes := changes || jsonb_build_object('security', jsonb_build_array(o.security, v_security)); END IF;
  IF NOT had OR o.tls_verify <> v_verify THEN changes := changes || jsonb_build_object('tls_verify', jsonb_build_array(o.tls_verify, v_verify)); END IF;
  IF NOT had OR o.sender_name <> v_name THEN changes := changes || jsonb_build_object('sender_name', jsonb_build_array(o.sender_name, v_name)); END IF;
  IF NOT had OR o.sender_email <> v_from THEN changes := changes || jsonb_build_object('sender_email', jsonb_build_array(o.sender_email, v_from)); END IF;
  v_password := CASE WHEN o.smtp_password_enc IS NULL AND v_pass IS NOT NULL THEN 'set'
                     WHEN o.smtp_password_enc IS NOT NULL AND v_pass IS NULL THEN 'removed'
                     WHEN p_password_enc IS NOT NULL AND v_pass IS NOT NULL THEN 'changed'
                     ELSE 'unchanged' END;

  INSERT INTO email_settings (id, smtp_host, smtp_port, smtp_username, smtp_password_enc, security, tls_verify, sender_name, sender_email, updated_at, updated_by)
  VALUES (true, v_host, p_port, v_user, v_pass, v_security, v_verify, v_name, v_from, now(), app_user_id())
  ON CONFLICT (id) DO UPDATE SET smtp_host = EXCLUDED.smtp_host, smtp_port = EXCLUDED.smtp_port, smtp_username = EXCLUDED.smtp_username, smtp_password_enc = EXCLUDED.smtp_password_enc,
    security = EXCLUDED.security, tls_verify = EXCLUDED.tls_verify, sender_name = EXCLUDED.sender_name, sender_email = EXCLUDED.sender_email, updated_at = EXCLUDED.updated_at, updated_by = EXCLUDED.updated_by;
  PERFORM treasury_audit(NULL, CASE WHEN had THEN 'EMAIL_SETTINGS_UPDATED' ELSE 'EMAIL_SETTINGS_CREATED' END, 'EMAIL_SETTINGS', NULL, jsonb_build_object('changes', changes, 'password', v_password));
END $$;

CREATE FUNCTION admin_clear_email_settings() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE o email_settings;
BEGIN
  IF NOT app_is_admin() THEN RAISE EXCEPTION 'only a system administrator can change the email settings' USING ERRCODE = '42501'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('email_settings', 0));
  DELETE FROM email_settings RETURNING * INTO o;
  IF NOT FOUND THEN RAISE EXCEPTION 'no email settings are saved' USING ERRCODE = 'P0002'; END IF;
  PERFORM treasury_audit(NULL, 'EMAIL_SETTINGS_CLEARED', 'EMAIL_SETTINGS', NULL, jsonb_build_object('smtp_host', o.smtp_host, 'smtp_port', o.smtp_port, 'smtp_username', o.smtp_username,
    'security', o.security, 'sender_name', o.sender_name, 'sender_email', o.sender_email, 'password', CASE WHEN o.smtp_password_enc IS NULL THEN 'none' ELSE 'removed' END));
END $$;

-- The saved settings with the encrypted password, for the server to open a connection. Useless without APP_ENCRYPTION_KEY, which only the servers hold.
CREATE FUNCTION admin_email_transport() RETURNS TABLE (smtp_host text, smtp_port integer, smtp_username text, smtp_password_enc text, security text, tls_verify boolean,
                                                       sender_name text, sender_email text, updated_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT app_is_admin() THEN RAISE EXCEPTION 'only a system administrator can send a test email' USING ERRCODE = '42501'; END IF;
  RETURN QUERY SELECT s.smtp_host, s.smtp_port, s.smtp_username, s.smtp_password_enc, s.security, s.tls_verify, s.sender_name, s.sender_email, s.updated_at FROM email_settings s;
END $$;

-- p_error NULL means the test email was accepted by the mail server.
CREATE FUNCTION admin_record_email_test(p_to text, p_source text, p_error text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT app_is_admin() THEN RAISE EXCEPTION 'only a system administrator can send a test email' USING ERRCODE = '42501'; END IF;
  IF p_source IS NULL OR p_source NOT IN ('SAVED', 'ENVIRONMENT') THEN RAISE EXCEPTION 'unknown email settings source' USING ERRCODE = '22023'; END IF;
  PERFORM treasury_audit(NULL, CASE WHEN p_error IS NULL THEN 'EMAIL_TEST_SENT' ELSE 'EMAIL_TEST_FAILED' END, 'EMAIL_SETTINGS', NULL,
    jsonb_strip_nulls(jsonb_build_object('to', left(lower(btrim(coalesce(p_to, ''))), 254), 'settings', p_source, 'error', left(p_error, 500))));
END $$;

CREATE FUNCTION worker_email_settings() RETURNS TABLE (smtp_host text, smtp_port integer, smtp_username text, smtp_password_enc text, security text, tls_verify boolean,
                                                       sender_name text, sender_email text, updated_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$ SELECT s.smtp_host, s.smtp_port, s.smtp_username, s.smtp_password_enc, s.security, s.tls_verify, s.sender_name, s.sender_email, s.updated_at FROM email_settings s $$;

REVOKE EXECUTE ON FUNCTION admin_email_settings(), admin_save_email_settings(text, integer, text, text, text, boolean, text, text), admin_clear_email_settings(),
  admin_email_transport(), admin_record_email_test(text, text, text), worker_email_settings() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_email_settings(), admin_save_email_settings(text, integer, text, text, text, boolean, text, text), admin_clear_email_settings(),
  admin_email_transport(), admin_record_email_test(text, text, text) TO abig_app;
GRANT EXECUTE ON FUNCTION worker_email_settings() TO abig_worker;
