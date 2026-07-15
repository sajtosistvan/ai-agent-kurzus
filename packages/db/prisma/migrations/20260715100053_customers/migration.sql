-- CreateTable
CREATE TABLE "customers" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contact_name" TEXT,
    "email" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "customer_type" TEXT NOT NULL,
    "budget" DECIMAL(12,2) NOT NULL,
    "expertise_level" TEXT NOT NULL,
    "pet_safe_required" BOOLEAN NOT NULL,
    "kid_safe_required" BOOLEAN NOT NULL,
    "notes" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "customers_code_key" ON "customers"("code");
