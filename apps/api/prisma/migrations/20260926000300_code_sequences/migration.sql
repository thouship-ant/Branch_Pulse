-- Human-readable code counters (LLD s1: EXP-BR002-26-000871). One gap-tolerant sequence per document type.
CREATE SEQUENCE seq_code_expense;
CREATE SEQUENCE seq_code_purchase;
CREATE SEQUENCE seq_code_transfer;
CREATE SEQUENCE seq_code_wastage;
CREATE SEQUENCE seq_code_supplier_payment;
CREATE SEQUENCE seq_code_advance;
CREATE SEQUENCE seq_code_employee;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_rw;
