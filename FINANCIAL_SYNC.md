# Keep customer payments, invoices and cash receipts consistent

Migration `0047_customer_payment_settlement.sql` and the updated frontend must be deployed together. No production database or deployment was changed during this task.

## Activate safely

1. Back up the database and verify migrations through `0046` are present.
2. Apply `0047` in staging, then deploy the frontend. Test a partial payment, its remaining invoice balance and its cash receipt before production rollout.
3. For an existing account with previously recorded, unassigned payments, open its customer record and select **Reconciliar**. Confirm the oldest-invoice-first allocation before proceeding.

Reconciliation can split historic payment ledger rows while preserving their amounts, dates and descriptions. It does not create, delete or change historic cash receipts. Review the account history before confirming.

## Financial contract

| Operation | Result |
| --- | --- |
| Collect from Sales | Opens the linked customer's payment form for that specific invoice; partial payments are supported. |
| Collect from Customers | Allocates to the oldest outstanding invoices first; excess becomes customer credit. |
| Record a receipt | Ledger, invoice status, account balance and actual cash receipt commit together. Stable request keys prevent duplicate submission on retry. |
| Adjust an account | Changes the ledger and balance atomically. An adjustment is not a cash receipt and does not settle an invoice. |
| Open Cash Flow | Shows cash actually received separately from amounts still receivable. |
| Edit/delete a collected account invoice | Rejected to preserve its receipts. Refunds need a dedicated reversal workflow, not a status toggle or deletion. |

Customer write permission and tenant ownership are checked server-side. Owner-attributed invoices also require the applicable operating access. Sales and account receipts invalidate all related caches. Financial reads use keyset pagination rather than silently truncating at the server row cap. Financial amounts retain cents.

## Verification and limits

- Production PL/pgSQL, triggers and constraints execute in isolated PGlite tests, including rollback on receipt failure, partial/FIFO payments, idempotency, tenant/permission checks and proportional owner cost.
- Browser fixtures verify Sales → Customers → Cash Flow navigation without reloading. They mock network data; they are not a production connectivity test.
- PGlite uses one connection: multi-session contention and actual Supabase deployment must still be verified in staging.
- The isolated migration harness supplies the missing default-removal prerequisite for historic migration `0006`; it does not modify that historic migration.
- Existing duplicate receipts, mismatched invoice/ledger amounts and historic owner attribution are not guessed or silently rewritten. They need an account-specific audit. Customer credit from an earlier receipt can be applied to a later invoice through reconciliation.
- Refund/reversal UI and real-time updates between separate sessions are not implemented here. Navigation refreshes invalidated data; this is not a claim of real-time synchronization across devices.

Run `npm run lint`, `npm test`, `npm run test:e2e` and `npm run perf:check` to reproduce the checks.
