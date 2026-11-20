BEGIN;
-- Mở kỳ hạn 6 tháng và trần 10 người. Giữ nguyên giá, chữ ký và quyền lợi của hợp đồng cũ.
ALTER TABLE service_packages ADD COLUMN video_quota_policy VARCHAR(20) NOT NULL DEFAULT 'FIXED',
  ADD COLUMN home_visit_unit_price DECIMAL(12,2);
ALTER TABLE service_packages DROP CONSTRAINT package_terms_valid;
ALTER TABLE service_packages ADD CONSTRAINT package_terms_valid CHECK (
 duration_months IN (1,3,6,12) AND base_price > 0 AND base_price=trunc(base_price) AND
 included_members > 0 AND max_members BETWEEN included_members AND 10 AND
 additional_member_monthly_price>=0 AND additional_member_monthly_price=trunc(additional_member_monthly_price) AND
 periodic_visits_quota>=0 AND telehealth_quota>=0 AND periodic_visits_quota+telehealth_quota>0 AND
 quota_period IN ('PER_TERM','PER_MONTH') AND video_quota_policy IN ('FIXED','CONTRACT') AND
 (home_visit_unit_price IS NULL OR (home_visit_unit_price>0 AND home_visit_unit_price=trunc(home_visit_unit_price))));
ALTER TABLE medical_contracts DROP CONSTRAINT medical_contracts_member_count_check;
ALTER TABLE medical_contracts ADD CONSTRAINT medical_contracts_member_count_check CHECK (member_count BETWEEN 1 AND 10);

-- Một hóa đơn có thể phân bổ nhiều tháng. Các dòng đã chốt theo cách cũ vẫn được giữ và không phân bổ lại.
ALTER TABLE facility_settlement_items ADD COLUMN recognition_year INTEGER,
 ADD COLUMN recognition_month INTEGER,
 ADD COLUMN recognition_basis VARCHAR(30) NOT NULL DEFAULT 'LEGACY_CASH',
 ADD COLUMN service_from DATE, ADD COLUMN service_until DATE;
UPDATE facility_settlement_items i SET recognition_year=s.year, recognition_month=s.month
 FROM facility_settlements s WHERE s.id=i.settlement_id;
DROP INDEX facility_settlement_items_invoice_id_key;
CREATE UNIQUE INDEX facility_settlement_items_invoice_id_recognition_year_recognition_month_key
 ON facility_settlement_items(invoice_id,recognition_year,recognition_month);
CREATE UNIQUE INDEX facility_settlement_items_legacy_invoice_key ON facility_settlement_items(invoice_id)
 WHERE recognition_basis='LEGACY_CASH';
ALTER TABLE facility_settlement_items ADD CONSTRAINT settlement_recognition_valid CHECK (
 recognition_basis IN ('LEGACY_CASH','SERVICE_DAYS') AND
 (recognition_month IS NULL OR recognition_month BETWEEN 1 AND 12));

-- Xuất bản phiên bản mới thay vì sửa gói đang được hợp đồng cũ tham chiếu.
WITH catalog(code,name,months,members,maximum,visits,video,price,unit,policy) AS (VALUES
 ('TRAI_NGHIEM','Trải nghiệm',1,1,2,1,1,1000000,1000000,'FIXED'),
 ('DONG_HANH','Đồng hành',3,3,6,3,4,2850000,950000,'FIXED'),
 ('AN_TAM','An tâm',6,4,8,7,8,6475000,925000,'FIXED'),
 ('TOAN_DIEN','Toàn diện',12,6,10,14,0,12600000,900000,'CONTRACT')),
 versions AS MATERIALIZED (SELECT c.*, COALESCE((SELECT max(version) FROM service_packages p WHERE p.lineage_code=c.code),0)+1 AS version FROM catalog c),
 retired AS (UPDATE service_packages SET status='DEPRECATED',retired_at=now() WHERE lineage_code IN (SELECT code FROM catalog) AND status='ACTIVE' RETURNING id)
INSERT INTO service_packages(id,package_code,lineage_code,version,package_name,duration_months,base_price,
 periodic_visits_quota,telehealth_quota,max_members,included_members,additional_member_monthly_price,
 quota_period,status,description,published_at,created_at,updated_at,video_quota_policy,home_visit_unit_price)
 SELECT gen_random_uuid(),code||'_V'||version,code,version,name,months,price,visits,video,maximum,members,
 75000,'PER_TERM','ACTIVE','Bảng dịch vụ 05/11/2026; video và nhắn tin đã bao gồm, không tăng lượt khi thêm người.',
 now(),now(),now(),policy,unit FROM versions CROSS JOIN (SELECT count(*) FROM retired) AS completed;
CREATE UNIQUE INDEX notifications_contract_expiry_once ON notifications(user_id,reference_id)
 WHERE type='CONTRACT_EXPIRY_15D';
COMMIT;
