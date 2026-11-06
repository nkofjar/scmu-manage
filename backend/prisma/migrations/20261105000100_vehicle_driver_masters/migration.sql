-- Legacy owner/employer classifications remain unknown; no inferred backfill.
CREATE TYPE "VehicleOwnershipType" AS ENUM ('OWN', 'VENDOR');
CREATE TYPE "DriverEmploymentType" AS ENUM ('INTERNAL', 'VENDOR');
CREATE TYPE "MasterDocumentCategory" AS ENUM ('STNK', 'KIR', 'SIM');

ALTER TABLE "vehicles"
  ADD COLUMN "ownershipType" "VehicleOwnershipType",
  ADD COLUMN "stnkExpiry" TIMESTAMP(3),
  ADD COLUMN "kirExpiry" TIMESTAMP(3),
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "drivers"
  ADD COLUMN "employmentType" "DriverEmploymentType",
  ADD COLUMN "licenseClass" TEXT,
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

CREATE TABLE "master_documents" (
  "id" TEXT NOT NULL,
  "vehicleId" TEXT,
  "driverId" TEXT,
  "category" "MasterDocumentCategory" NOT NULL,
  "filename" TEXT NOT NULL,
  "originalName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "size" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "master_documents_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "master_documents_owner_category_check" CHECK (
    ("vehicleId" IS NOT NULL AND "driverId" IS NULL AND "category" IN ('STNK', 'KIR')) OR
    ("vehicleId" IS NULL AND "driverId" IS NOT NULL AND "category" = 'SIM')
  ),
  CONSTRAINT "master_documents_size_check" CHECK ("size" > 0 AND "size" <= 5242880)
);
CREATE UNIQUE INDEX "master_documents_filename_key" ON "master_documents"("filename");
CREATE INDEX "master_documents_vehicleId_createdAt_idx" ON "master_documents"("vehicleId", "createdAt");
CREATE INDEX "master_documents_driverId_createdAt_idx" ON "master_documents"("driverId", "createdAt");
ALTER TABLE "master_documents" ADD CONSTRAINT "master_documents_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "master_documents" ADD CONSTRAINT "master_documents_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "drivers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
