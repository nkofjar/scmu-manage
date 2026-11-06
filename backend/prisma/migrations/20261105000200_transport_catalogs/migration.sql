-- Extend existing masters only; historical prices and tariff snapshots are untouched.
ALTER TABLE "routes" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "goods_types" ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
CREATE TABLE "operating_cost_types" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "defaultUnit" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "operating_cost_types_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "operating_cost_types_unit_check" CHECK ("defaultUnit" IN ('BL','CONTAINER','RIT','TON','DAY'))
);
CREATE UNIQUE INDEX "operating_cost_types_code_key" ON "operating_cost_types"("code");
ALTER TABLE "jpt_tariffs" ADD COLUMN "operatingCostTypeId" TEXT,
  ADD COLUMN "routeId" TEXT, ADD COLUMN "ownershipType" TEXT;
ALTER TABLE "jpt_tariffs" ADD CONSTRAINT "jpt_tariffs_operatingCostTypeId_fkey"
  FOREIGN KEY ("operatingCostTypeId") REFERENCES "operating_cost_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "jpt_tariffs" ADD CONSTRAINT "jpt_tariffs_routeId_fkey"
  FOREIGN KEY ("routeId") REFERENCES "routes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "jpt_tariffs" ADD CONSTRAINT "jpt_tariffs_ownershipType_check"
  CHECK ("ownershipType" IS NULL OR "ownershipType" IN ('OWN','VENDOR'));
