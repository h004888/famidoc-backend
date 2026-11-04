-- Gộp ba bảng vào hợp đồng/chữ ký. Không sửa các migration đã áp dụng trước đây.
BEGIN;
LOCK TABLE medical_contracts, contract_signatures, contract_addenda,
  contract_members, contract_addendum_signatures, contract_termination_requests
  IN ACCESS EXCLUSIVE MODE;

ALTER TABLE medical_contracts
  ADD COLUMN member_count INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN legacy_member_ids JSONB,
  ADD COLUMN termination_requests JSONB NOT NULL DEFAULT '[]';

-- Giữ nguyên billing_snapshot đã ký; chuyển số người và danh sách cũ sang hợp đồng.
UPDATE medical_contracts c SET
  member_count = GREATEST(
    COALESCE((c.billing_snapshot #>> '{members,requestedCount}')::integer, 1),
    (SELECT count(*)::integer FROM contract_members m WHERE m.contract_id=c.id), 1),
  legacy_member_ids = COALESCE(
    (SELECT jsonb_agg(m.patient_id::text ORDER BY m.patient_id)
     FROM contract_members m WHERE m.contract_id=c.id), '[]'::jsonb),
  termination_requests = COALESCE(
    (SELECT jsonb_agg(jsonb_build_object(
      'id', r.id, 'contractId', r.contract_id, 'requestedByUserId', r.requested_by_user_id,
      'reason', r.reason, 'termsHash', r.terms_hash, 'status', r.status,
      'consents', r.consents, 'decisionNotes', r.decision_notes,
      'decidedByUserId', r.decided_by_user_id, 'decidedAt', r.decided_at,
      'createdAt', r.created_at) ORDER BY r.created_at, r.id)
     FROM contract_termination_requests r WHERE r.contract_id=c.id), '[]'::jsonb);

ALTER TABLE medical_contracts ADD CONSTRAINT medical_contracts_member_count_check
  CHECK (member_count BETWEEN 1 AND 6);
ALTER TABLE medical_contracts ADD CONSTRAINT medical_contracts_termination_requests_check
  CHECK (jsonb_typeof(termination_requests)='array');

ALTER TABLE contract_signatures ADD COLUMN addendum_id UUID;
DROP INDEX contract_signatures_contract_id_signer_role_key;
CREATE INDEX contract_signatures_contract_id_idx ON contract_signatures(contract_id);
CREATE UNIQUE INDEX contract_signatures_base_role_key
  ON contract_signatures(contract_id, signer_role) WHERE addendum_id IS NULL;
CREATE UNIQUE INDEX contract_signatures_addendum_role_key
  ON contract_signatures(addendum_id, signer_role) WHERE addendum_id IS NOT NULL;
CREATE UNIQUE INDEX contract_addenda_id_contract_id_key ON contract_addenda(id, contract_id);
-- Khóa ghép bảo đảm không gắn chữ ký phụ lục vào một hợp đồng khác.
ALTER TABLE contract_signatures ADD CONSTRAINT contract_signatures_addendum_id_contract_id_fkey
  FOREIGN KEY(addendum_id, contract_id) REFERENCES contract_addenda(id, contract_id)
  ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO contract_signatures
  (id, contract_id, addendum_id, signer_role, signer_user_id, signature_hash, terms_hash, signed_at, ip_address)
SELECT s.id, a.contract_id, s.addendum_id, s.signer_role, s.signer_user_id,
  s.signature_hash, s.terms_hash, s.signed_at, s.ip_address
FROM contract_addendum_signatures s JOIN contract_addenda a ON a.id=s.addendum_id;

-- Chỉ bỏ bảng nguồn sau khi đã chuyển đủ bản ghi; có sai khác thì rollback toàn bộ.
DO $$ BEGIN
  IF (SELECT count(*) FROM contract_signatures WHERE addendum_id IS NOT NULL)
     <> (SELECT count(*) FROM contract_addendum_signatures) THEN
    RAISE EXCEPTION 'Addendum signature migration lost rows';
  END IF;
  IF (SELECT COALESCE(sum(jsonb_array_length(termination_requests)),0) FROM medical_contracts)
     <> (SELECT count(*) FROM contract_termination_requests) THEN
    RAISE EXCEPTION 'Termination request migration lost rows';
  END IF;
END $$;
DROP TABLE contract_members;
DROP TABLE contract_addendum_signatures;
DROP TABLE contract_termination_requests;
-- Giữ nguyên facility_settlement_items và các hóa đơn/chi tiết quyết toán.
COMMIT;
