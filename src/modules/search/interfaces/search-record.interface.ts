import type { SearchType } from '../search.constants';

export interface LocalizedText {
  es: string;
  en: string;
}

/** Category / facility as the cards need it (slug drives facets, icon drives chips). */
export interface SearchTaxonomyItem {
  id: string;
  slug: string;
  name: LocalizedText;
  icon: string | null;
}

/** Flat arrays for faceting and searching + the full items for rendering. */
export interface SearchTaxonomy {
  slugs: string[];
  es: string[];
  en: string[];
  items: SearchTaxonomyItem[];
}

export interface SearchBadge {
  id: string;
  slug: string;
  name: string;
  icon: string | null;
  iconColor: string | null;
  backgroundColor: string | null;
  imageUrl: string | null;
}

export interface SearchTown {
  id: string;
  slug: string | null;
  name: string;
  department: string | null;
}

/**
 * One document of the unified `{prefix}_catalog` index. Common attributes are always present;
 * per-type attributes are optional and only set for their type. Never put private data here
 * (documents, license plates, owner emails) — the browser key can read every retrievable field.
 */
export interface SearchRecord {
  objectID: string;
  type: SearchType;
  id: string;
  slug: string | null;
  /** Frontend path of the detail page, without locale prefix nor host. */
  path: string;
  name: string;
  /** Manual EN override of the name (business names are not auto-translated). */
  nameEn?: string;

  town: SearchTown | null;
  /** Every town where the entity shows up — the only tenant filter. */
  townSlugs: string[];
  _geoloc?: { lat: number; lng: number };

  image: string | null;
  images: string[];
  categories: SearchTaxonomy;
  facilities: SearchTaxonomy;
  badges: SearchBadge[];

  description: LocalizedText;
  details: LocalizedText;
  concepts: string[];

  price: { from?: number; to?: number; unit?: string; featuredLabel?: string };
  rating: {
    display: number;
    count: number;
    binntu: number;
    binntuCount: number;
    google?: number;
    googleCount?: number;
  };
  /** Meters to the urban center (what the cards print) + km for numeric filters. */
  urbanCenterDistance?: number;
  distanceKm?: number;
  points?: number;

  paymentMethods: string[];
  acceptsCard: boolean;
  spokenLanguages: string[];
  contact: {
    whatsapp: string[];
    phones: string[];
    address?: string;
    googleMapsUrl?: string;
    lat?: number;
    lng?: number;
  };

  isPremium: boolean;
  isVerified: boolean;
  hasPromotion: boolean;
  promotion?: { value: number; endsAt: number };
  showGoogleReviews: boolean;
  showBinntuReviews: boolean;

  /** Unix seconds; queries filter `visibleUntil > now` (events expire, the rest never does). */
  visibleUntil: number;
  /** customRanking inputs: boost (Premium / featured place) + daily rotation. Unretrievable. */
  rank: { boost: number; shuffle: number };

  // --- lodging ---
  roomTypes?: string[];
  amenitiesText?: string[];
  capacity?: number;
  rooms?: number;

  // --- restaurant ---
  menu?: { dishes: string[]; sections: string[] };
  priceRanges?: { label: string; priceFrom: number; featured?: boolean }[];
  zone?: string;
  hasMenu?: boolean;
  menuUrl?: string;

  // --- experience / place ---
  difficulty?: number;
  minAge?: number;
  maxAge?: number;
  minParticipants?: number;
  maxParticipants?: number;
  durationMinutes?: number;
  totalDistanceM?: number;
  guide?: { id: string; name: string; slug: string | null };
  additionalPrices?: { label: string; price: number }[];
  isFeatured?: boolean;
  showLocation?: boolean;
  temperature?: number;
  altitude?: number;
  maxDepth?: number;

  // --- commerce ---
  services?: string[];
  products?: string[];

  // --- guide / transport ---
  firstName?: string;
  lastName?: string;
  profilePhoto?: string | null;
  languages?: string[];
  isAvailable?: boolean;
  social?: { instagram?: string; facebook?: string; youtube?: string; tiktok?: string };
  hourSlots?: string[];
  startTime?: string;
  endTime?: string;
  vehicleModel?: string;

  // --- event ---
  startTs?: number;
  endTs?: number;
  eventPrices?: { name: string; value: number }[];
}
