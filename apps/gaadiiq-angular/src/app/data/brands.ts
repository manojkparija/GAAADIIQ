export interface Brand {
  name: string;
  slug: string;
  logo: string;
  country: string;
}

// Brand logos: the real marks, served from this repo.
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
// The first fix for that pointed these rows at hand-drawn SVGs already in the
// repo. That stopped the placeholders but was wrong in a worse way: those
// files are approximations, not logos — kia.svg was the word "KIA" set in
// Arial Black, hyundai.svg a navy ellipse with a literal letter H. Reported
// as "except mahindra all the logos are wrong", and they were.
//
// These .png files are the real marks, downloaded once from the same dataset
// the CDN URLs pointed at (filippofilip95/car-logos-dataset, `master`) and
// committed here. `@latest` was the original bug: jsDelivr resolves it to the
// newest version tag and that repository publishes none, so every URL 404'd.
// Pinning the ref would have fixed today's outage and left the dependency;
// committing the files removes it.
//
// Mahindra, Force Motors and OLA Electric keep their SVGs. Mahindra's is
// properly drawn — migration 004 moved it local precisely because the
// dataset's thumbnail is unreadable at grid size — and the dataset carries no
// mark for the other two.
//
// The superseded SVGs are deliberately left in place: brands.service falls
// back to `assets/brand-logos/<slug>.svg` when logo_url is NULL, so deleting
// them before 022 runs would put the placeholders back.
//
// Migration 022_brand_logos_real_marks.sql does the same to the brands table,
// which is what the app actually reads; this list is the fallback for when
// that table has no rows.

export const BRANDS: Brand[] = [
  { name: 'Tata',          slug: 'tata',          logo: 'assets/brand-logos/tata.png',          country: 'India'   },
  { name: 'Maruti Suzuki', slug: 'maruti-suzuki',  logo: 'assets/brand-logos/maruti-suzuki.png',        country: 'India'   },
  // Local rather than the CDN: that dataset's Mahindra thumbnail is the older
  // mark set beneath a wordmark, so at grid size the mark itself is a few
  // pixels tall and the wordmark is unreadable — it is visibly the faintest
  // tile in a row of crisp ones. The local SVG is the mark alone and stays
  // sharp at any size.
  { name: 'Mahindra',      slug: 'mahindra',       logo: 'assets/brand-logos/mahindra.svg', country: 'India' },
  { name: 'Nissan',        slug: 'nissan',         logo: 'assets/brand-logos/nissan.png',        country: 'Japan'   },
  { name: 'Hyundai',       slug: 'hyundai',        logo: 'assets/brand-logos/hyundai.png',       country: 'Korea'   },
  { name: 'Toyota',        slug: 'toyota',         logo: 'assets/brand-logos/toyota.png',        country: 'Japan'   },
  { name: 'Kia',           slug: 'kia',            logo: 'assets/brand-logos/kia.png',           country: 'Korea'   },
  { name: 'BMW',           slug: 'bmw',            logo: 'assets/brand-logos/bmw.png',           country: 'Germany' },
  { name: 'Skoda',         slug: 'skoda',          logo: 'assets/brand-logos/skoda.png',         country: 'Czech'   },
  { name: 'MG',            slug: 'mg',             logo: 'assets/brand-logos/mg.png',            country: 'UK/China'},
  { name: 'Renault',       slug: 'renault',        logo: 'assets/brand-logos/renault.png',       country: 'France'  },
  { name: 'Volkswagen',    slug: 'volkswagen',     logo: 'assets/brand-logos/volkswagen.png',    country: 'Germany' },
  { name: 'Mercedes-Benz', slug: 'mercedes-benz',  logo: 'assets/brand-logos/mercedes-benz.png', country: 'Germany' },
  { name: 'Honda',         slug: 'honda',          logo: 'assets/brand-logos/honda.png',         country: 'Japan'   },
  { name: 'Land Rover',    slug: 'land-rover',     logo: 'assets/brand-logos/land-rover.png',    country: 'UK'      },
  { name: 'Citroen',       slug: 'citroen',        logo: 'assets/brand-logos/citroen.png',       country: 'France'  },
  { name: 'VinFast',       slug: 'vinfast',        logo: 'assets/brand-logos/vinfast.png',       country: 'Vietnam' },
  { name: 'BYD',           slug: 'byd',            logo: 'assets/brand-logos/byd.png',           country: 'China'   },
  { name: 'Jeep',          slug: 'jeep',           logo: 'assets/brand-logos/jeep.png',          country: 'USA'     },
  { name: 'Audi',          slug: 'audi',           logo: 'assets/brand-logos/audi.png',          country: 'Germany' },
  { name: 'Porsche',       slug: 'porsche',        logo: 'assets/brand-logos/porsche.png',       country: 'Germany' },
  { name: 'Volvo',         slug: 'volvo',          logo: 'assets/brand-logos/volvo.png',         country: 'Sweden'  },
  { name: 'Lexus',         slug: 'lexus',          logo: 'assets/brand-logos/lexus.png',         country: 'Japan'   },
  { name: 'Mini',          slug: 'mini',           logo: 'assets/brand-logos/mini.png',          country: 'UK'      },
  { name: 'Force Motors',  slug: 'force-motors',   logo: `assets/brand-logos/force-motors.svg`, country: 'India' },
  { name: 'Lamborghini',   slug: 'lamborghini',    logo: 'assets/brand-logos/lamborghini.png',   country: 'Italy'   },
  { name: 'Jaguar',        slug: 'jaguar',         logo: 'assets/brand-logos/jaguar.png',        country: 'UK'      },
  { name: 'Rolls-Royce',   slug: 'rolls-royce',    logo: 'assets/brand-logos/rolls-royce.png',   country: 'UK'      },
  { name: 'Ferrari',       slug: 'ferrari',        logo: 'assets/brand-logos/ferrari.png',       country: 'Italy'   },
  { name: 'Tesla',         slug: 'tesla',          logo: 'assets/brand-logos/tesla.png',         country: 'USA'     },
  { name: 'Isuzu',         slug: 'isuzu',          logo: 'assets/brand-logos/isuzu.png',         country: 'Japan'   },
  { name: 'Maserati',      slug: 'maserati',       logo: 'assets/brand-logos/maserati.png',      country: 'Italy'   },
  { name: 'Aston Martin',  slug: 'aston-martin',   logo: 'assets/brand-logos/aston-martin.png',  country: 'UK'      },
  { name: 'McLaren',       slug: 'mclaren',        logo: 'assets/brand-logos/mclaren.png',       country: 'UK'      },
  { name: 'Bentley',       slug: 'bentley',        logo: 'assets/brand-logos/bentley.png',       country: 'UK'      },
  { name: 'Lotus',         slug: 'lotus',          logo: 'assets/brand-logos/lotus.png',         country: 'UK'      },
  { name: 'OLA Electric',  slug: 'ola-electric',   logo: `assets/brand-logos/ola-electric.svg`, country: 'India' },
  { name: 'Genesis',       slug: 'genesis',        logo: 'assets/brand-logos/genesis.png',       country: 'Korea'   },
];
