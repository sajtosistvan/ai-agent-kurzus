import { z } from 'zod';

// A `products` rekord validációs sémája — az ingest-agent EGYETLEN írási útjának határvédelme.
// Az LLM-output megbízhatatlan input → szigorú Zod a rendszer-határon (konvenciok.md), fail-fast.
// Az enumok a schema.prisma kommentjeiből (a séma forrása: system-prompt.md). String-literal union.

export const CATEGORY = [
  'szobanövény', 'kerti', 'pozsgás', 'kaktusz', 'fűszer', 'fa-cserje', 'lógó', 'virágzó',
] as const;
export const LOCATION = ['beltéri', 'kültéri', 'mindkettő'] as const;
export const LIGHT = ['árnyék', 'alacsony', 'közepes', 'erős', 'direkt nap'] as const;
export const WATERING = ['ritka', 'közepes', 'gyakori', 'állandóan nedves'] as const;
export const DIFFICULTY = ['kezdő', 'haladó', 'profi'] as const;

export const ProductInputSchema = z
  .object({
    name: z.string().min(1), // MAGYAR termék-név
    latinName: z.string().min(1), // botanikai név — ez a termék természetes kulcsa (dedup)
    category: z.enum(CATEGORY),
    location: z.enum(LOCATION),
    price: z.number().positive(), // HUF, > 0
    salePrice: z.number().positive().nullable(), // akciós ár vagy null
    stock: z.number().int().nonnegative(),
    light: z.enum(LIGHT),
    watering: z.enum(WATERING),
    difficulty: z.enum(DIFFICULTY),
    currentHeightCm: z.number().int().positive(),
    maxHeightCm: z.number().int().positive(),
    currentPotCm: z.number().int().positive(),
    petSafe: z.boolean(),
    kidSafe: z.boolean(),
    airPurifying: z.boolean(),
    rating: z.number().min(0).max(5),
    reviewsCount: z.number().int().nonnegative(),
    description: z.string().min(1), // MAGYAR leírás
  })
  .strict()
  .refine((p) => p.salePrice == null || p.salePrice < p.price, {
    message: 'a salePrice csak a price alatt lehet (akciós ár)',
    path: ['salePrice'],
  });

export type ProductInput = z.infer<typeof ProductInputSchema>;

// A mezők és a hozzájuk tartozó snake_case oszlopok — a paraméterezett INSERT/UPDATE innen áll össze
// (egy helyen a sorrend, hogy az oszlop-lista és az értékek ne csússzanak el).
export const PRODUCT_COLUMNS: ReadonlyArray<readonly [keyof ProductInput, string]> = [
  ['name', 'name'],
  ['latinName', 'latin_name'],
  ['category', 'category'],
  ['location', 'location'],
  ['price', 'price'],
  ['salePrice', 'sale_price'],
  ['stock', 'stock'],
  ['light', 'light'],
  ['watering', 'watering'],
  ['difficulty', 'difficulty'],
  ['currentHeightCm', 'current_height_cm'],
  ['maxHeightCm', 'max_height_cm'],
  ['currentPotCm', 'current_pot_cm'],
  ['petSafe', 'pet_safe'],
  ['kidSafe', 'kid_safe'],
  ['airPurifying', 'air_purifying'],
  ['rating', 'rating'],
  ['reviewsCount', 'reviews_count'],
  ['description', 'description'],
];
