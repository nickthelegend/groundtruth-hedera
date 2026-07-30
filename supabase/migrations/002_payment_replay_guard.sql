-- Payment replay protection.
--
-- Before this migration, replay was only detected via the payments.payment_ref
-- primary key. But payment_ref is caller-influenced, so a single genuine
-- on-chain transfer could be resubmitted with a fresh reference and mint
-- unlimited paid tasks. Bind each on-chain tx to at most one payment row.
--
-- The index is partial (WHERE tx_hash IS NOT NULL) so demo-mode rows, which
-- carry no real tx hash, are exempt and never collide with one another.

create unique index if not exists payments_tx_hash_unique
  on payments (tx_hash)
  where tx_hash is not null;
