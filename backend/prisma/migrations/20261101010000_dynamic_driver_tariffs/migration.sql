ALTER TABLE "jpt_tariffs" ADD COLUMN "rateType" TEXT;
ALTER TABLE "jpt_tariffs" ADD COLUMN "routeOrigin" TEXT;
ALTER TABLE "jpt_tariffs" ADD COLUMN "routeDestination" TEXT;
ALTER TABLE "jpt_tariffs" ADD COLUMN "vehicleNumber" TEXT;
ALTER TABLE "jpt_tariffs" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
CREATE INDEX "jpt_tariffs_driver_lookup_idx" ON "jpt_tariffs"("category","rateType","size","effectiveFrom","effectiveTo");
CREATE TABLE "driver_rate_schemes" (
 "id" TEXT PRIMARY KEY, "code" TEXT NOT NULL UNIQUE, "name" TEXT NOT NULL,
 "size" TEXT NOT NULL, "rb" INTEGER NOT NULL, "rk" INTEGER NOT NULL,
 "enabled" BOOLEAN NOT NULL DEFAULT true, "version" INTEGER NOT NULL DEFAULT 1,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- Operational suggestions supplied by SCMU. No monetary prices are assumed.
INSERT INTO "driver_rate_schemes" ("id","code","name","size","rb","rk") VALUES
 ('20_3_RB','20_3_RB','20 feet / 3 RB','20',3,0),
 ('20_2_RB_2_RK','20_2_RB_2_RK','20 feet / 2 RB + 2 RK','20',2,2),
 ('40_6_RB','40_6_RB','40 feet / 6 RB','40',6,0);
