BEGIN;
ALTER TABLE contract_signatures ADD COLUMN terms_hash VARCHAR(64);
ALTER TABLE facility_settlements ADD CONSTRAINT facility_settlements_confirmer_fkey FOREIGN KEY (confirmed_by_user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE complaints ADD CONSTRAINT complaints_facility_reviewer_fkey FOREIGN KEY (facility_reviewed_by_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE complaints ADD CONSTRAINT complaints_resolver_fkey FOREIGN KEY (resolved_by_user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE contract_termination_requests ADD CONSTRAINT termination_decider_fkey FOREIGN KEY (decided_by_user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE;
COMMIT;
