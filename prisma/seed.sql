-- Dev/test seed. Run as the owner role. Bypasses RLS by design.
INSERT INTO companies (id, code, legal_name, tin_number, phone) VALUES
 ('c0000000-0000-4000-8000-000000000001','ASKU','ASKU PLC','0011223344','+251911000001'),
 ('c0000000-0000-4000-8000-000000000002','BERBERO','Berbero Petrochemical PLC','0022334455','+251911000002'),
 ('c0000000-0000-4000-8000-000000000003','BEES','BEES PLC','0033445566','+251911000003'),
 ('c0000000-0000-4000-8000-000000000004','DAILYMART','Daily Mart','0044556677','+251911000004');

-- Roles per company. Roles themselves (ACCOUNTANT, FINANCE_MANAGER, OWNER) come from the migrations.
CREATE FUNCTION pg_temp.give(p_user uuid, p_company uuid, p_roles text[]) RETURNS void LANGUAGE plpgsql AS $$
DECLARE m uuid;
BEGIN
  INSERT INTO company_memberships (company_id, user_id) VALUES (p_company, p_user) RETURNING id INTO m;
  INSERT INTO membership_roles (membership_id, role_id) SELECT m, id FROM roles WHERE code = ANY(p_roles);
END $$;

INSERT INTO users (id, email, full_name, is_system_admin) VALUES
 ('a0000000-0000-4000-8000-000000000001','admin@abig.test','System Admin',true),
 ('a0000000-0000-4000-8000-000000000002','meron@abig.test','Meron (ASKU accountant)',false),
 ('a0000000-0000-4000-8000-000000000003','lidya@abig.test','Lidya (ASKU accountant)',false),
 ('a0000000-0000-4000-8000-000000000004','hana@abig.test','Hana (Berbero owner)',false),
 ('a0000000-0000-4000-8000-000000000005','tigist@abig.test','Tigist (Berbero accountant)',false),
 ('a0000000-0000-4000-8000-000000000006','samuel@abig.test','Samuel (BEES accountant)',false),
 ('a0000000-0000-4000-8000-000000000007','abebe@abig.test','Abebe (BEES owner and finance manager)',false),
 ('a0000000-0000-4000-8000-000000000008','bereket@abig.test','Bereket (Daily Mart accountant)',false),
 ('a0000000-0000-4000-8000-000000000009','selam@abig.test','Selam (group reporting)',false);

SELECT pg_temp.give(u, c, r) FROM (VALUES
 ('a0000000-0000-4000-8000-000000000002'::uuid,'c0000000-0000-4000-8000-000000000001'::uuid,ARRAY['ACCOUNTANT']),          -- Meron: ASKU accountant
 ('a0000000-0000-4000-8000-000000000003','c0000000-0000-4000-8000-000000000001',ARRAY['ACCOUNTANT']),                       -- Lidya: ASKU accountant
 ('a0000000-0000-4000-8000-000000000004','c0000000-0000-4000-8000-000000000002',ARRAY['OWNER']),                            -- Hana: Berbero owner
 ('a0000000-0000-4000-8000-000000000005','c0000000-0000-4000-8000-000000000002',ARRAY['ACCOUNTANT']),                       -- Tigist: Berbero accountant
 ('a0000000-0000-4000-8000-000000000006','c0000000-0000-4000-8000-000000000003',ARRAY['ACCOUNTANT']),                       -- Samuel: BEES accountant
 ('a0000000-0000-4000-8000-000000000007','c0000000-0000-4000-8000-000000000003',ARRAY['OWNER','FINANCE_MANAGER']),          -- Abebe: BEES owner and finance manager
 ('a0000000-0000-4000-8000-000000000008','c0000000-0000-4000-8000-000000000004',ARRAY['ACCOUNTANT'])                        -- Bereket: Daily Mart accountant
) AS t(u, c, r);

-- Selam has group reporting for ASKU and BEES only (not Berbero, not Daily Mart).
INSERT INTO group_permission_grants (user_id, permission, company_id) VALUES
 ('a0000000-0000-4000-8000-000000000009','GROUP_REPORT_VIEW','c0000000-0000-4000-8000-000000000001'),
 ('a0000000-0000-4000-8000-000000000009','GROUP_REPORT_VIEW','c0000000-0000-4000-8000-000000000003');

INSERT INTO banks (id, name) VALUES ('f0000000-0000-4000-8000-000000000001','CBE'), ('f0000000-0000-4000-8000-000000000002','Awash');
-- current_balance is what the Accountant last entered; reserved_balance starts at 0; available_balance is generated.
INSERT INTO company_bank_accounts (id, bank_id, account_label, account_last4, min_buffer, current_balance, balance_updated_at) VALUES
 ('b0000000-0000-4000-8000-000000000001','f0000000-0000-4000-8000-000000000001','BEES CBE current','4417',200000, 4200000, now() - interval '30 hours'),
 ('b0000000-0000-4000-8000-000000000002','f0000000-0000-4000-8000-000000000002','ASKU Awash current','1032',100000, 1150000, now() - interval '6 hours');

-- The owner of an account is a row in the junction table too (is_owner). BEES owns the CBE account, ASKU the Awash one.
-- BEES shares its CBE account with ASKU (use) and Berbero (use + may update the balance).
INSERT INTO company_bank_account_access (account_id, company_id, is_owner, permissions, granted_by) VALUES
 ('b0000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000003', true,  '{USE,RECORD_SNAPSHOT}','a0000000-0000-4000-8000-000000000007'),
 ('b0000000-0000-4000-8000-000000000002','c0000000-0000-4000-8000-000000000001', true,  '{USE,RECORD_SNAPSHOT}','a0000000-0000-4000-8000-000000000003'),
 ('b0000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000001', false, '{USE}','a0000000-0000-4000-8000-000000000007'),
 ('b0000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000002', false, '{USE,RECORD_SNAPSHOT}','a0000000-0000-4000-8000-000000000007');

-- ---------- Phase 2 seed ----------
INSERT INTO users (id, email, full_name) VALUES ('a0000000-0000-4000-8000-000000000010','dawit@abig.test','Dawit (ASKU finance manager)');
SELECT pg_temp.give('a0000000-0000-4000-8000-000000000010','c0000000-0000-4000-8000-000000000001',ARRAY['FINANCE_MANAGER']);  -- Dawit

INSERT INTO suppliers (id, legal_name, tin, created_by) VALUES
 ('d0000000-0000-4000-8000-000000000001','Hawassa Packaging PLC','0012345678','a0000000-0000-4000-8000-000000000002'),
 ('d0000000-0000-4000-8000-000000000002','Ethio Chemicals SC','0023456789','a0000000-0000-4000-8000-000000000002'),
 ('d0000000-0000-4000-8000-000000000003','Addis Hardware Traders','0056789012','a0000000-0000-4000-8000-000000000002');
INSERT INTO supplier_bank_details (id, supplier_id, bank_name, account_last4, created_by) VALUES
 ('e0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000001','CBE','2210','a0000000-0000-4000-8000-000000000002'),
 ('e0000000-0000-4000-8000-000000000002','d0000000-0000-4000-8000-000000000002','Awash','5532','a0000000-0000-4000-8000-000000000002'),
 ('e0000000-0000-4000-8000-000000000003','d0000000-0000-4000-8000-000000000003','Abyssinia','3350','a0000000-0000-4000-8000-000000000002');
-- Verified by Dawit (not the creator). Addis Hardware Traders stays PENDING on purpose.
UPDATE supplier_bank_details SET status = 'VERIFIED', verified_by = 'a0000000-0000-4000-8000-000000000010'
 WHERE id IN ('e0000000-0000-4000-8000-000000000001','e0000000-0000-4000-8000-000000000002');
INSERT INTO company_suppliers (company_id, supplier_id, created_by) VALUES
 ('c0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000002'),
 ('c0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000003','a0000000-0000-4000-8000-000000000002'),
 ('c0000000-0000-4000-8000-000000000002','d0000000-0000-4000-8000-000000000002','a0000000-0000-4000-8000-000000000004');

-- ---------- Phase 3 seed ----------
INSERT INTO users (id, email, full_name) VALUES
 ('a0000000-0000-4000-8000-000000000011','kebede@abig.test','Kebede (ASKU owner)'),
 ('a0000000-0000-4000-8000-000000000012','yared@abig.test','Yared (ASKU, holds all three roles)');
SELECT pg_temp.give('a0000000-0000-4000-8000-000000000011','c0000000-0000-4000-8000-000000000001',ARRAY['OWNER']);                                   -- Kebede
SELECT pg_temp.give('a0000000-0000-4000-8000-000000000012','c0000000-0000-4000-8000-000000000001',ARRAY['ACCOUNTANT','FINANCE_MANAGER','OWNER']);  -- Yared: all three

-- ---------- Phase 4 seed ----------
INSERT INTO users (id, email, full_name) VALUES
 ('a0000000-0000-4000-8000-000000000013','nardos@abig.test','Nardos (Berbero accountant)'),
 ('a0000000-0000-4000-8000-000000000014','fikru@abig.test','Fikru (Berbero finance manager)');
SELECT pg_temp.give('a0000000-0000-4000-8000-000000000013','c0000000-0000-4000-8000-000000000002',ARRAY['ACCOUNTANT']);       -- Nardos
SELECT pg_temp.give('a0000000-0000-4000-8000-000000000014','c0000000-0000-4000-8000-000000000002',ARRAY['FINANCE_MANAGER']);   -- Fikru
