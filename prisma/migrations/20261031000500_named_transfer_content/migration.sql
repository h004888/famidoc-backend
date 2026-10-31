BEGIN;
-- Thêm cột vào hóa đơn; giữ nguyên số bảng nghiệp vụ và mã các hóa đơn cũ.
ALTER TABLE invoices ADD COLUMN transfer_content VARCHAR(140);
UPDATE invoices SET transfer_content=invoice_code;

-- Sequence là bộ cấp số của PostgreSQL, không phải một bảng nghiệp vụ mới.
-- Không reset hoặc quay vòng: một mã thanh toán không được gán cho hóa đơn khác về sau.
CREATE SEQUENCE payment_code_number_seq AS BIGINT MINVALUE 1 START 1 NO CYCLE;
SELECT setval('payment_code_number_seq',
  COALESCE((SELECT MAX(substring(invoice_code FROM 3)::integer)
    FROM invoices WHERE invoice_code ~ '^FD[0-9]{6}$'), 0) + 1, false);
COMMIT;
