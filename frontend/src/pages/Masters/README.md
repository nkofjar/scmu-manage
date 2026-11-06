# Transport catalogs integration

The parent integrator owns app/server/navigation/manifests and migration execution.

## Mounts / exports

- `/delivery-routes`: default `DeliveryRoutes` from `./pages/Masters/DeliveryRoutes.jsx`.
- `/goods-types`: default `GoodsTypes` from `./pages/Masters/GoodsTypes.jsx`.
- Operating cost types are integrated in the existing default `TariffCosts` (`./pages/Operations/TariffCosts.jsx`) through `JPTTariffs`; do not add another sidebar manager. The internal default `OperatingCostTypes` accepts `embedded`.
- Mount CommonJS router `backend/src/routes/operatingCostTypes.js` at `/api/operating-cost-types`. Existing `/api/routes`, `/api/goods`, `/api/jpt-tariffs` routers are extended in place.

## API contract

`GET /routes?limit=200`, `/goods?limit=200`, `/operating-cost-types?limit=200` return `{data,total,page,limit,pages}`; the existing unpaginated Route/GoodsType reads retain their array contract. Query `active=true|false|all` (default true), optional search/page. Masters include `isActive` and integer `version`; cost types have `id,code,name,defaultUnit,isActive,version` (no finance `costCategory`). POST accepts only editable master fields; PUT `/:id` additionally requires the current numeric version. Toggle activation via PUT `{version,isActive}`. No DELETE endpoint.

Tariff editable additions: nullable `operatingCostTypeId`, `routeId`, `ownershipType` (`OWN|VENDOR|null`), existing effective dates, units `BL|CONTAINER|RIT|TON|DAY`. Create/edit permits ADMIN/SUPER_ADMIN; backend route authorization also permits MANAGER/OPERATOR/VIEWER reads, but the application's global login policy currently authenticates only ADMIN/SUPER_ADMIN. The integrator must reconcile a broader STAFF login policy if intended; this worker did not modify auth.

Tariff updates require version and use atomic compare-and-swap. Unknown/inactive master references are rejected; a tariff already referencing an inactive master may still be disabled. Driver RB/RK tariffs retain their established route/vehicle matching and reject new service-master scopes rather than silently ignoring them. Service RIT/TON/DAY rates can be managed, but the B/L automatic estimate intentionally supports only BL/CONTAINER, since it has no authoritative trip/day/ton quantity input. Scoped B/L estimates reject absent/mismatched route/ownership rather than guessing. Existing saved charge/bon snapshots are not repriced by master edits.

Expense integrators should resolve `tx.operatingCostType.findUnique({where:{id}})`, require active selection, and snapshot `{id,code,name,defaultUnit}` into their existing immutable cost metadata. Finance `costCategory` remains independent.

## Additive schema

Migration `backend/prisma/migrations/20261105000200_transport_catalogs/migration.sql` adds Route.version, GoodsType.isActive/version, durable OperatingCostType, and nullable JptTariff scope fields with foreign keys. No prices or seed data; no snapshot rewriting. Parent must guard development database, apply migrations, generate Prisma client, and perform live authenticated integration. This worker performed schema validation only, not database/process writes.

## Verification / test registration

Manifests were deliberately not edited. Add these focused files to the parent's normal test gate:

```sh
cd backend
node --test test/transportCatalogs.test.js test/operatingCostTypes.test.js test/transportTariffsRoutes.test.js test/transportCatalogSafety.test.js
cd ../frontend
node src/pages/Masters/transportCatalogs.interaction.test.mjs
```

Observed RED→GREEN: create-on-update duplicate identity, missing cost router, ADMIN tariff authorization/allowlist/scopes, unsupported units in form, unavailable route/goods pages, ignored driver scopes, and unsafe tariff stale actions after post-commit read failure. HTTP tests use real Express routers with in-memory persistence seams, not live database integration. UI tests use real components with React interaction rendering, not browser layout proof.

Verified: backend normal suite 342 passing, document suite 100 passing, focused catalog/safety HTTP suite 8 passing; frontend normal tests 37 passing plus package render checks, focused interaction script passing, production build passing, `prisma validate` passing, `git diff --check` clean. Remaining warnings are existing Vite CJS/React Router notices, stale Browserslist data and bundle-size warning.
