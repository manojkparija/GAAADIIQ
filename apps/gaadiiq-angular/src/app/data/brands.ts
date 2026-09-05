export interface Brand {
  name: string;
  slug: string;
  logo: string;
  country: string;
}

// Brand logos are served from this repo, not a third-party CDN.
//
// These rows used to point at
// cdn.jsdelivr.net/gh/filippofilip95/car-logos-dataset@latest/... and the
// brand grid on /new-cars rendered as a wall of dark "No Image Available"
// tiles, because onImgError swaps in placeholder.svg when a logo will not
// load. The only two brands that survived were the only two NOT on the CDN.
//
// `@latest` is not a pin: it resolves to whatever that repository's newest
// tag happens to be, and neither the tag nor the repo nor the file layout is
// ours. The failure is also silent — nothing throws, the grid just quietly
// fills with placeholders.
//
// Every one of these SVGs is in src/assets/brand-logos/, served from our own
// origin and cached by the service worker's `assets` group. Migration
// 021_brand_logos_off_the_cdn.sql does the same to the brands table, which is
// what the app actually reads; this list is the fallback for when that table
// has no rows.

export const BRANDS: Brand[] = [
  { name: 'Tata',          slug: 'tata',          logo: 'assets/brand-logos/tata.svg',          country: 'India'   },
  { name: 'Maruti Suzuki', slug: 'maruti-suzuki',  logo: 'assets/brand-logos/maruti-suzuki.svg',        country: 'India'   },
  // Local rather than the CDN: that dataset's Mahindra thumbnail is the older
  // mark set beneath a wordmark, so at grid size the mark itself is a few
  // pixels tall and the wordmark is unreadable — it is visibly the faintest
  // tile in a row of crisp ones. The local SVG is the mark alone and stays
  // sharp at any size.
  { name: 'Mahindra',      slug: 'mahindra',       logo: 'assets/brand-logos/mahindra.svg', country: 'India' },
  { name: 'Nissan',        slug: 'nissan',         logo: 'assets/brand-logos/nissan.svg',        country: 'Japan'   },
  { name: 'Hyundai',       slug: 'hyundai',        logo: 'assets/brand-logos/hyundai.svg',       country: 'Korea'   },
  { name: 'Toyota',        slug: 'toyota',         logo: 'assets/brand-logos/toyota.svg',        country: 'Japan'   },
  { name: 'Kia',           slug: 'kia',            logo: 'assets/brand-logos/kia.svg',           country: 'Korea'   },
  { name: 'BMW',           slug: 'bmw',            logo: 'assets/brand-logos/bmw.svg',           country: 'Germany' },
  { name: 'Skoda',         slug: 'skoda',          logo: 'assets/brand-logos/skoda.svg',         country: 'Czech'   },
  { name: 'MG',            slug: 'mg',             logo: 'assets/brand-logos/mg.svg',            country: 'UK/China'},
  { name: 'Renault',       slug: 'renault',        logo: 'assets/brand-logos/renault.svg',       country: 'France'  },
  { name: 'Volkswagen',    slug: 'volkswagen',     logo: 'assets/brand-logos/volkswagen.svg',    country: 'Germany' },
  { name: 'Mercedes-Benz', slug: 'mercedes-benz',  logo: 'assets/brand-logos/mercedes-benz.svg', country: 'Germany' },
  { name: 'Honda',         slug: 'honda',          logo: 'assets/brand-logos/honda.svg',         country: 'Japan'   },
  { name: 'Land Rover',    slug: 'land-rover',     logo: 'assets/brand-logos/land-rover.svg',    country: 'UK'      },
  { name: 'Citroen',       slug: 'citroen',        logo: 'assets/brand-logos/citroen.svg',       country: 'France'  },
  { name: 'VinFast',       slug: 'vinfast',        logo: 'assets/brand-logos/vinfast.svg',       country: 'Vietnam' },
  { name: 'BYD',           slug: 'byd',            logo: 'assets/brand-logos/byd.svg',           country: 'China'   },
  { name: 'Jeep',          slug: 'jeep',           logo: 'assets/brand-logos/jeep.svg',          country: 'USA'     },
  { name: 'Audi',          slug: 'audi',           logo: 'assets/brand-logos/audi.svg',          country: 'Germany' },
  { name: 'Porsche',       slug: 'porsche',        logo: 'assets/brand-logos/porsche.svg',       country: 'Germany' },
  { name: 'Volvo',         slug: 'volvo',          logo: 'assets/brand-logos/volvo.svg',         country: 'Sweden'  },
  { name: 'Lexus',         slug: 'lexus',          logo: 'assets/brand-logos/lexus.svg',         country: 'Japan'   },
  { name: 'Mini',          slug: 'mini',           logo: 'assets/brand-logos/mini.svg',          country: 'UK'      },
  { name: 'Force Motors',  slug: 'force-motors',   logo: `assets/brand-logos/force-motors.svg`, country: 'India' },
  { name: 'Lamborghini',   slug: 'lamborghini',    logo: 'assets/brand-logos/lamborghini.svg',   country: 'Italy'   },
  { name: 'Jaguar',        slug: 'jaguar',         logo: 'assets/brand-logos/jaguar.svg',        country: 'UK'      },
  { name: 'Rolls-Royce',   slug: 'rolls-royce',    logo: 'assets/brand-logos/rolls-royce.svg',   country: 'UK'      },
  { name: 'Ferrari',       slug: 'ferrari',        logo: 'assets/brand-logos/ferrari.svg',       country: 'Italy'   },
  { name: 'Tesla',         slug: 'tesla',          logo: 'assets/brand-logos/tesla.svg',         country: 'USA'     },
  { name: 'Isuzu',         slug: 'isuzu',          logo: 'assets/brand-logos/isuzu.svg',         country: 'Japan'   },
  { name: 'Maserati',      slug: 'maserati',       logo: 'assets/brand-logos/maserati.svg',      country: 'Italy'   },
  { name: 'Aston Martin',  slug: 'aston-martin',   logo: 'assets/brand-logos/aston-martin.svg',  country: 'UK'      },
  { name: 'McLaren',       slug: 'mclaren',        logo: 'assets/brand-logos/mclaren.svg',       country: 'UK'      },
  { name: 'Bentley',       slug: 'bentley',        logo: 'assets/brand-logos/bentley.svg',       country: 'UK'      },
  { name: 'Lotus',         slug: 'lotus',          logo: 'assets/brand-logos/lotus.svg',         country: 'UK'      },
  { name: 'OLA Electric',  slug: 'ola-electric',   logo: `assets/brand-logos/ola-electric.svg`, country: 'India' },
  { name: 'Genesis',       slug: 'genesis',        logo: 'assets/brand-logos/genesis.svg',       country: 'Korea'   },
];
