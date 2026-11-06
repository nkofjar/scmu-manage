# Verified delivery service prices

`backend/src/services/deliveryPriceCatalog.js` contains the user-verified **HARGA BARU** transcription: **18 source rows, 23 prices (18 RIT / RB-column + 5 TON), 15 destination-group routes**. BURUH / RET is LABOR (2 prices); the other 21 prices are TRUCKING. None are DRIVER_BON payroll. RB is retained in codes/notes, **not** the service tariff `rateType`.

Unreadable MUTING ULILIN, ASIKI, MINDIPTANA, WAROPKO and KUMBE / lower KURIK are omitted. Missing TON cells are omitted, not zeroed. Grouped labels remain grouped; this does not guess individual destinations. Dates, container sizes, carrier and ownership scopes are not inferred. Prices do not reprice historic jobs/invoices/bonrate snapshots or automatically calculate VAT/PPh. Tax treatment is explicitly marked unspecified in notes.

New routes are active and reuse matching names (case/whitespace insensitive). Required unknown geography strings are empty, not fabricated; distance and duration are null. Existing route IDs/geography are preserved. Same-code or unambiguous same-description/category/unit/scope service tariffs are updated; existing codes, IDs and office notes are preserved. Ambiguous matches, incompatible code scopes, existing tax treatment and effective-dated tariffs require manual review and stop the import. No driver wages or unrelated masters are modified.

## Commands from repository root

No `.env` files are loaded, and no environment `DATABASE_URL` is used. Use the explicit non-secret local trust URL shown here. Avoid placing production credentials in shell history; use a secure connection mechanism outside this importer if needed.

Read-only preview (safe default):

```bash
node scripts/import-delivery-price-catalog.cjs --database-url 'postgresql://scmu_demo@127.0.0.1:55432/scmu_demo'
```

Authorized parent/operator apply only; this agent has **not** applied it to public/live tables. Pick a NEW backup path in a secured directory which already exists:

```bash
node scripts/import-delivery-price-catalog.cjs --database-url 'postgresql://scmu_demo@127.0.0.1:55432/scmu_demo' --apply --confirm-target '127.0.0.1:55432/scmu_demo/public' --backup 'D:/Doc/scmu managemen system/.demo/delivery-prices-before.json'
```

Then rerun the preview: all 15 routes and 23 tariffs must be unchanged. Normal `/routes` and `/jpt-tariffs` reads, including the existing service tariff master editor, expose imported data; no alternate frontend catalog is added.

Apply takes a serializable transaction with locks on the two catalog tables, writes an exclusive fsynced JSON backup with SHA-256 before mutations, checks master versions, and reads back the result both before and after commit. An existing backup path aborts safely. The backup contains those full catalog tables plus the exact plan, **not** a full database dump. A database error rolls back all catalog mutations; a post-commit verification error needs operator review using the retained backup (not blind retry). For non-demo targets a separately secured full database backup is required, plus explicit `--allow-non-demo`; the script never defaults to a live database.

## Verification

Unit/regression tests are registered in `backend/package.json`'s normal test command:

```bash
cd backend
node --test test/deliveryPriceCatalog.test.js
```

Real database integration is explicitly opt-in and restricted to localhost:55432/scmu_demo. It creates a unique disposable schema, copies the actual table definitions (not public data), exercises dry-run/apply/backup/idempotency/existing-price updates/payroll preservation/rollback, verifies public row counts are unchanged, and drops only its owned schema. It does not apply catalog rows to public tables:

```bash
DELIVERY_PRICE_CATALOG_TEST_URL='postgresql://scmu_demo@127.0.0.1:55432/scmu_demo' node --test test/deliveryPriceCatalog.integration.test.js
```

The integration runner requires the configured `TMPDIR` for disposable backups. Without its opt-in URL the integration test is skipped, not claimed as executed.
