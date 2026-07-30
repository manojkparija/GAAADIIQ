export interface Brand {
  name: string;
  slug: string;
  logo: string;
  country: string;
}

const CDN = 'https://cdn.jsdelivr.net/gh/filippofilip95/car-logos-dataset@latest/logos/thumb';

export const BRANDS: Brand[] = [
  { name: 'Tata',          slug: 'tata',          logo: `${CDN}/tata.png`,          country: 'India'   },
  { name: 'Maruti Suzuki', slug: 'maruti-suzuki',  logo: `${CDN}/suzuki.png`,        country: 'India'   },
  // Local rather than the CDN: that dataset's Mahindra thumbnail is the older
  // mark set beneath a wordmark, so at grid size the mark itself is a few
  // pixels tall and the wordmark is unreadable — it is visibly the faintest
  // tile in a row of crisp ones. The local SVG is the mark alone and stays
  // sharp at any size.
  { name: 'Mahindra',      slug: 'mahindra',       logo: 'assets/brand-logos/mahindra.svg', country: 'India' },
  { name: 'Nissan',        slug: 'nissan',         logo: `${CDN}/nissan.png`,        country: 'Japan'   },
  { name: 'Hyundai',       slug: 'hyundai',        logo: `${CDN}/hyundai.png`,       country: 'Korea'   },
  { name: 'Toyota',        slug: 'toyota',         logo: `${CDN}/toyota.png`,        country: 'Japan'   },
  { name: 'Kia',           slug: 'kia',            logo: `${CDN}/kia.png`,           country: 'Korea'   },
  { name: 'BMW',           slug: 'bmw',            logo: `${CDN}/bmw.png`,           country: 'Germany' },
  { name: 'Skoda',         slug: 'skoda',          logo: `${CDN}/skoda.png`,         country: 'Czech'   },
  { name: 'MG',            slug: 'mg',             logo: `${CDN}/mg.png`,            country: 'UK/China'},
  { name: 'Renault',       slug: 'renault',        logo: `${CDN}/renault.png`,       country: 'France'  },
  { name: 'Volkswagen',    slug: 'volkswagen',     logo: `${CDN}/volkswagen.png`,    country: 'Germany' },
  { name: 'Mercedes-Benz', slug: 'mercedes-benz',  logo: `${CDN}/mercedes-benz.png`, country: 'Germany' },
  { name: 'Honda',         slug: 'honda',          logo: `${CDN}/honda.png`,         country: 'Japan'   },
  { name: 'Land Rover',    slug: 'land-rover',     logo: `${CDN}/land-rover.png`,    country: 'UK'      },
  { name: 'Citroen',       slug: 'citroen',        logo: `${CDN}/citroen.png`,       country: 'France'  },
  { name: 'VinFast',       slug: 'vinfast',        logo: `${CDN}/vinfast.png`,       country: 'Vietnam' },
  { name: 'BYD',           slug: 'byd',            logo: `${CDN}/byd.png`,           country: 'China'   },
  { name: 'Jeep',          slug: 'jeep',           logo: `${CDN}/jeep.png`,          country: 'USA'     },
  { name: 'Audi',          slug: 'audi',           logo: `${CDN}/audi.png`,          country: 'Germany' },
  { name: 'Porsche',       slug: 'porsche',        logo: `${CDN}/porsche.png`,       country: 'Germany' },
  { name: 'Volvo',         slug: 'volvo',          logo: `${CDN}/volvo.png`,         country: 'Sweden'  },
  { name: 'Lexus',         slug: 'lexus',          logo: `${CDN}/lexus.png`,         country: 'Japan'   },
  { name: 'Mini',          slug: 'mini',           logo: `${CDN}/mini.png`,          country: 'UK'      },
  { name: 'Force Motors',  slug: 'force-motors',   logo: `assets/brand-logos/force-motors.svg`, country: 'India' },
  { name: 'Lamborghini',   slug: 'lamborghini',    logo: `${CDN}/lamborghini.png`,   country: 'Italy'   },
  { name: 'Jaguar',        slug: 'jaguar',         logo: `${CDN}/jaguar.png`,        country: 'UK'      },
  { name: 'Rolls-Royce',   slug: 'rolls-royce',    logo: `${CDN}/rolls-royce.png`,   country: 'UK'      },
  { name: 'Ferrari',       slug: 'ferrari',        logo: `${CDN}/ferrari.png`,       country: 'Italy'   },
  { name: 'Tesla',         slug: 'tesla',          logo: `${CDN}/tesla.png`,         country: 'USA'     },
  { name: 'Isuzu',         slug: 'isuzu',          logo: `${CDN}/isuzu.png`,         country: 'Japan'   },
  { name: 'Maserati',      slug: 'maserati',       logo: `${CDN}/maserati.png`,      country: 'Italy'   },
  { name: 'Aston Martin',  slug: 'aston-martin',   logo: `${CDN}/aston-martin.png`,  country: 'UK'      },
  { name: 'McLaren',       slug: 'mclaren',        logo: `${CDN}/mclaren.png`,       country: 'UK'      },
  { name: 'Bentley',       slug: 'bentley',        logo: `${CDN}/bentley.png`,       country: 'UK'      },
  { name: 'Lotus',         slug: 'lotus',          logo: `${CDN}/lotus.png`,         country: 'UK'      },
  { name: 'OLA Electric',  slug: 'ola-electric',   logo: `assets/brand-logos/ola-electric.svg`, country: 'India' },
  { name: 'Genesis',       slug: 'genesis',        logo: `${CDN}/genesis.png`,       country: 'Korea'   },
];
