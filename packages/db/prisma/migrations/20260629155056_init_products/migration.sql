-- CreateTable
CREATE TABLE "products" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "latin_name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    "sale_price" DECIMAL(12,2),
    "stock" INTEGER NOT NULL,
    "light" TEXT NOT NULL,
    "watering" TEXT NOT NULL,
    "difficulty" TEXT NOT NULL,
    "current_height_cm" INTEGER NOT NULL,
    "max_height_cm" INTEGER NOT NULL,
    "current_pot_cm" INTEGER NOT NULL,
    "pet_safe" BOOLEAN NOT NULL,
    "kid_safe" BOOLEAN NOT NULL,
    "air_purifying" BOOLEAN NOT NULL,
    "rating" DECIMAL(3,2) NOT NULL,
    "reviews_count" INTEGER NOT NULL,
    "description" TEXT NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);
