-- PostgreSQL giới hạn tên index 63 ký tự. Dùng tên ngắn rõ nghĩa để schema Prisma không bị drift.
ALTER INDEX facility_settlement_items_invoice_id_recognition_year_recogniti
  RENAME TO settlement_invoice_period_unique;
