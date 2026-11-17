-- ABIG Finance - A system administrator can correct a person's name and email address.
--
-- A person is known by two things: the name shown everywhere (users.full_name) and the email address they sign in with (users.email).
-- Until now neither could be corrected after the person was created. This migration adds one audited way to change them and nothing else:
--
--   * admin_update_user_identity(user, name, email) is the only route. It refuses anyone who is not an active system administrator, and the
--     System user. The application role loses its direct UPDATE on users.full_name (it never had one on users.email), so a name or an email
--     address cannot change without the audit entry.
--   * A name is a person's real name, so two people may share one: names are trimmed, required and at most 120 characters, not unique.
--     Email addresses were already unique and stored in lower case, and are compared that way. The rules are held by the database for every
--     route, including the creation of a person.
--   * Each change is audited with the administrator and the previous and new value: USER_NAME_CHANGED, USER_EMAIL_CHANGED.
--   * The email address is what a person signs in with, so changing it signs that person out everywhere (their sessions are deleted in the same
--     transaction) and is written to the sign-in log. An administrator changing their own address keeps the session they are working in; the
--     application ends their other sessions. A name change does not touch sessions: a session names the person by id.
--   * Nothing else about the person changes: password, two-step sign-in, lock, active flag, administrator flag, company access, roles and
--     group reporting are not read or written here.
--
-- Existing rows are not rewritten or re-checked, so this migration cannot fail on data already in a database.

-- Runs for a new person and whenever a statement sets the name or the email address.
CREATE FUNCTION users_identity_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.full_name IS DISTINCT FROM OLD.full_name THEN
    NEW.full_name := regexp_replace(btrim(coalesce(NEW.full_name, '')), '\s+', ' ', 'g');
    IF NEW.full_name = '' THEN RAISE EXCEPTION 'the name is required' USING ERRCODE = '23514'; END IF;
    IF length(NEW.full_name) > 120 THEN RAISE EXCEPTION 'the name is too long (120 characters at most)' USING ERRCODE = '23514'; END IF;
  END IF;
  IF TG_OP = 'INSERT' OR NEW.email IS DISTINCT FROM OLD.email THEN
    IF NEW.email IS NULL OR NEW.email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' OR length(NEW.email) > 254 THEN
      RAISE EXCEPTION 'enter a valid email address' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER users_identity_guard BEFORE INSERT OR UPDATE OF full_name, email ON users FOR EACH ROW EXECUTE FUNCTION users_identity_guard();

-- The sign-in log gains one event.
ALTER TABLE auth_events DROP CONSTRAINT auth_events_event_check;
ALTER TABLE auth_events ADD CONSTRAINT auth_events_event_check
  CHECK (event IN ('LOGIN_OK','LOGIN_FAILED','LOGIN_LOCKED','MFA_FAILED','LOGOUT','PASSWORD_CHANGED','PASSWORD_RESET','MFA_ENABLED','MFA_DISABLED','SESSIONS_REVOKED','EMAIL_CHANGED'));

-- Returns UNCHANGED, NAME, EMAIL or BOTH: what was actually different.
CREATE FUNCTION admin_update_user_identity(p_user uuid, p_name text, p_email text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  o users;
  v_name text := regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g');
  v_email text := lower(btrim(coalesce(p_email, '')));
  name_changed boolean; email_changed boolean;
BEGIN
  IF NOT app_is_admin() THEN RAISE EXCEPTION 'only a system administrator can change a person''s name or email address' USING ERRCODE = '42501'; END IF;
  SELECT * INTO o FROM users WHERE id = p_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'person not found' USING ERRCODE = 'P0002'; END IF;
  IF o.id = app_system_user() THEN RAISE EXCEPTION 'the System user records automatic actions and cannot be changed' USING ERRCODE = '42501'; END IF;
  IF v_name = '' THEN RAISE EXCEPTION 'the name is required' USING ERRCODE = '23514'; END IF;
  IF v_email = '' THEN RAISE EXCEPTION 'the email address is required' USING ERRCODE = '23514'; END IF;
  IF v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' OR length(v_email) > 254 THEN RAISE EXCEPTION 'enter a valid email address' USING ERRCODE = '23514'; END IF;
  name_changed := v_name <> o.full_name; email_changed := v_email <> o.email;
  IF NOT name_changed AND NOT email_changed THEN RETURN 'UNCHANGED'; END IF;
  IF email_changed AND EXISTS (SELECT 1 FROM users u WHERE u.email = v_email AND u.id <> p_user) THEN
    RAISE EXCEPTION 'another person already has that email address' USING ERRCODE = '23505';
  END IF;

  -- Only these two columns. The name rule is in users_identity_guard; users_email_key settles two simultaneous email changes.
  IF name_changed AND email_changed THEN UPDATE users SET full_name = v_name, email = v_email WHERE id = p_user;
  ELSIF name_changed THEN UPDATE users SET full_name = v_name WHERE id = p_user;
  ELSE UPDATE users SET email = v_email WHERE id = p_user; END IF;

  IF name_changed THEN
    PERFORM treasury_audit(NULL, 'USER_NAME_CHANGED', 'USER', p_user, jsonb_build_object('previous', o.full_name, 'new', v_name));
  END IF;
  IF email_changed THEN
    PERFORM treasury_audit(NULL, 'USER_EMAIL_CHANGED', 'USER', p_user, jsonb_build_object('previous', o.email, 'new', v_email, 'signed_out', p_user <> app_user_id()));
    INSERT INTO auth_events (user_id, email, event, detail) VALUES (p_user, v_email, 'EMAIL_CHANGED', 'changed by an administrator; previous address ' || o.email);
    IF p_user <> app_user_id() THEN
      DELETE FROM sessions WHERE user_id = p_user;
      INSERT INTO auth_events (user_id, email, event, detail) VALUES (p_user, v_email, 'SESSIONS_REVOKED', 'email address changed');
    END IF;
  END IF;
  RETURN CASE WHEN name_changed AND email_changed THEN 'BOTH' WHEN name_changed THEN 'NAME' ELSE 'EMAIL' END;
END $$;

REVOKE EXECUTE ON FUNCTION users_identity_guard(), admin_update_user_identity(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_update_user_identity(uuid, text, text) TO abig_app;
-- The name now changes only through the audited function above.
REVOKE UPDATE (full_name) ON users FROM abig_app;
