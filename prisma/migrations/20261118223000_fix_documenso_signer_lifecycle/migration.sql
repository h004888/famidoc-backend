-- Gỡ ràng buộc unique toàn cục trên documenso_recipient_id (dễ va chạm với seed/reset Documenso)
-- và thay bằng index thường phục vụ tra cứu.
DROP INDEX IF EXISTS "contract_documenso_signers_documenso_recipient_id_key";

CREATE INDEX IF NOT EXISTS "idx_contract_documenso_signers_recipient_id"
  ON "contract_documenso_signers" ("documenso_recipient_id");

-- Dọn dữ liệu giả lập (https://documenso.local/...) và signer của bản nháp đã TERMINATED chưa thanh toán.
DELETE FROM "contract_documenso_signers"
WHERE "documenso_signing_url" LIKE 'https://documenso.local/%';

DELETE FROM "contract_documenso_signers" AS cds
USING "medical_contracts" AS mc
WHERE cds."contract_id" = mc."id"
  AND mc."contract_status" = 'TERMINATED'
  AND NOT EXISTS (
    SELECT 1
    FROM "invoices" AS inv
    WHERE inv."contract_id" = mc."id"
      AND inv."payment_status" = 'PAID'
  );
