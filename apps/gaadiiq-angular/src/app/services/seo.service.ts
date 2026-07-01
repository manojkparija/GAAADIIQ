import { Injectable } from '@angular/core';
import { Title, Meta } from '@angular/platform-browser';

@Injectable({ providedIn: 'root' })
export class SeoService {
  constructor(private title: Title, private meta: Meta) {}

  setCarDetail(make: string, model: string, year: number, price: number, city: string) {
    const t = `${year} ${make} ${model} for sale in ${city} | Gaadiiq`;
    this.title.setTitle(t);
    this.setMeta([
      { name: 'description', content: `Buy ${year} ${make} ${model} in ${city}. AI-verified listing, EMI calculator, price analysis. Starting ₹${(price/100000).toFixed(1)}L.` },
      { property: 'og:title', content: t },
      { property: 'og:type', content: 'product' },
      { name: 'robots', content: 'index, follow' },
    ]);
  }

  setPage(pageTitle: string, description: string) {
    this.title.setTitle(`${pageTitle} | Gaadiiq — India's AI Car Marketplace`);
    this.setMeta([
      { name: 'description', content: description },
      { property: 'og:title', content: `${pageTitle} | Gaadiiq` },
      { name: 'robots', content: 'index, follow' },
    ]);
  }

  private setMeta(tags: { name?: string; property?: string; content: string }[]) {
    tags.forEach(tag => {
      if (tag.name) this.meta.updateTag({ name: tag.name, content: tag.content });
      if (tag.property) this.meta.updateTag({ property: tag.property, content: tag.content });
    });
  }
}
