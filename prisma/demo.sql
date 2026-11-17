-- Demo requests in several states, so the screens have something to show. Run after seed.sql, as the owner role.
-- (Invoice files are recorded in the database but do not exist in storage, so downloading them gives "not found".)
CREATE FUNCTION pg_temp.demo(p_company uuid, p_supplier uuid, p_bank uuid, p_creator uuid, p_account uuid, p_amounts numeric[], p_dues int[], p_priority text, p_ref text) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE rid uuid; i int;
BEGIN
  PERFORM set_config('app.user_id', p_creator::text, true);
  INSERT INTO payment_requests (debtor_company_id, supplier_id, supplier_bank_detail_id, debit_account_id, created_by, invoice_ref, invoice_date, total_amount, priority)
  VALUES (p_company, p_supplier, p_bank, p_account, p_creator, p_ref, current_date - 5, (SELECT sum(x) FROM unnest(p_amounts) x), p_priority) RETURNING id INTO rid;
  FOR i IN 1..array_length(p_amounts, 1) LOOP
    INSERT INTO payment_installments (request_id, seq, due_date, amount) VALUES (rid, i, current_date + p_dues[i], p_amounts[i]);
  END LOOP;
  INSERT INTO attachments (request_id, kind, object_key, filename, mime_type, size_bytes, sha256, uploaded_by)
  VALUES (rid, 'INVOICE', md5(random()::text) || md5(random()::text), p_ref || '.pdf', 'application/pdf', 1000, md5(random()::text) || md5(random()::text), p_creator);
  RETURN rid;
END $$;

-- Balances before: ASKU Awash 1,150,000 and BEES CBE 4,200,000 (nothing reserved).
DO $$
DECLARE
  asku constant uuid := 'c0000000-0000-4000-8000-000000000001'; berbero constant uuid := 'c0000000-0000-4000-8000-000000000002';
  hawassa constant uuid := 'd0000000-0000-4000-8000-000000000001'; ethio constant uuid := 'd0000000-0000-4000-8000-000000000002';
  bd_h constant uuid := 'e0000000-0000-4000-8000-000000000001'; bd_e constant uuid := 'e0000000-0000-4000-8000-000000000002';
  meron constant uuid := 'a0000000-0000-4000-8000-000000000002'; dawit constant uuid := 'a0000000-0000-4000-8000-000000000010'; kebede constant uuid := 'a0000000-0000-4000-8000-000000000011';
  nardos constant uuid := 'a0000000-0000-4000-8000-000000000013'; fikru constant uuid := 'a0000000-0000-4000-8000-000000000014'; hana constant uuid := 'a0000000-0000-4000-8000-000000000004';
  awash constant uuid := 'b0000000-0000-4000-8000-000000000002'; cbe constant uuid := 'b0000000-0000-4000-8000-000000000001';
  r uuid; v int; w uuid; k uuid;
BEGIN
  -- Authenticated: the 380,000 has already been debited from the Awash account (current 770,000).
  r := pg_temp.demo(asku, hawassa, bd_h, meron, awash, ARRAY[380000], ARRAY[9], 'NORMAL', 'HP-2026-0103');
  PERFORM set_config('app.user_id', meron::text, true); v := wf_submit(r);
  PERFORM set_config('app.user_id', dawit::text, true); v := wf_verify(r, v);
  PERFORM set_config('app.user_id', kebede::text, true); PERFORM wf_authorize(r, v);
  -- Waiting for verification: 600,000 reserved on Awash (770,000 less the 100,000 minimum buffer leaves 670,000 available).
  r := pg_temp.demo(asku, hawassa, bd_h, meron, awash, ARRAY[600000], ARRAY[5], 'NORMAL', 'HP-2026-0102');
  PERFORM set_config('app.user_id', meron::text, true); PERFORM wf_submit(r);
  -- Cancelled by its creator: its funds were released.
  r := pg_temp.demo(asku, hawassa, bd_h, meron, awash, ARRAY[50000], ARRAY[12], 'NORMAL', 'HP-2026-0105');
  PERFORM set_config('app.user_id', meron::text, true); v := wf_submit(r);
  PERFORM wf_cancel(r, v, 'Ordered by mistake');
  -- Verified, waiting for the Owner: Berbero pays 2,300,000 from the shared BEES CBE account.
  r := pg_temp.demo(berbero, ethio, bd_e, nardos, cbe, ARRAY[2300000], ARRAY[7], 'HIGH', 'EC-7781');
  PERFORM set_config('app.user_id', nardos::text, true); v := wf_submit(r);
  PERFORM set_config('app.user_id', fikru::text, true); PERFORM wf_verify(r, v);
  -- Rejected by the Owner: its funds were released.
  r := pg_temp.demo(asku, hawassa, bd_h, meron, cbe, ARRAY[800000, 800000], ARRAY[-4, 14], 'URGENT', 'HP-2026-0104');
  PERFORM set_config('app.user_id', meron::text, true); v := wf_submit(r);
  PERFORM set_config('app.user_id', dawit::text, true); v := wf_verify(r, v);
  PERFORM set_config('app.user_id', kebede::text, true); PERFORM wf_reject(r, v, 'Supplier delivery not confirmed');
  -- Returned to its creator by the Finance Manager: a draft again.
  r := pg_temp.demo(berbero, ethio, bd_e, nardos, cbe, ARRAY[120000], ARRAY[3], 'NORMAL', 'EC-7790');
  PERFORM set_config('app.user_id', nardos::text, true); v := wf_submit(r);
  PERFORM set_config('app.user_id', fikru::text, true); PERFORM wf_return(r, v, 'The invoice number does not match the attached file');
  -- A Telebirr wallet and a petty cash account for ASKU, with their first balances.
  PERFORM set_config('app.user_id', kebede::text, true);
  w := register_wallet_account(asku, 'ASKU Telebirr', '0911 000 111', 0);
  k := register_cash_account(asku, 'ASKU petty cash', 0);
  PERFORM set_config('app.user_id', meron::text, true);
  PERFORM record_opening_balance(w, 45000); PERFORM record_opening_balance(k, 20000);
  -- A plain draft.
  PERFORM pg_temp.demo(asku, hawassa, bd_h, meron, awash, ARRAY[250000], ARRAY[20], 'NORMAL', 'HP-2026-0101');
END $$;
