import { Component, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, ActivatedRoute } from '@angular/router';
import { SeoService } from '../../services/seo.service';
import { NewsService } from '../../services/news.service';
import { IconComponent } from '../../components/icon/icon.component';

export interface Article {
  id: number;
  category: 'News' | 'Expert Review' | 'User Review' | 'Special Report';
  title: string;
  excerpt: string;
  author: string;
  authorAvatar: string;
  date: string;
  readTime: string;
  tag: string;
  tagColor: string;
  image: string;
  rating?: number;
  carModel?: string;
  featured?: boolean;
}

export const ARTICLES: Article[] = [
  // ── NEWS ────────────────────────────────────────────────────────────────────
  {
    id: 1, category: 'News', featured: true,
    title: 'Tata Motors Launches Nexon EV Facelift With 500 km Range',
    excerpt: 'Tata Motors has unveiled the Nexon EV facelift with an upgraded 60 kWh battery pack, promising a real-world range of 500 km on a single charge. The new model also gets ADAS Level 2 features and a redesigned interior.',
    author: 'Rahul Sharma', authorAvatar: 'RS', date: '5 Jul 2026', readTime: '3 min read',
    tag: 'EV', tagColor: 'green', image: 'zap',
  },
  {
    id: 2, category: 'News',
    title: 'Maruti Suzuki to Launch 3 New EVs by 2027 Under ₹15L',
    excerpt: 'Maruti Suzuki has confirmed plans to launch three electric vehicles priced under ₹15 lakh by 2027, targeting the mass-market segment. The lineup will include a hatchback, compact sedan, and a small SUV.',
    author: 'Priya Nair', authorAvatar: 'PN', date: '4 Jul 2026', readTime: '4 min read',
    tag: 'Industry', tagColor: 'blue', image: 'factory',
  },
  {
    id: 3, category: 'News',
    title: 'Government Extends FAME-III Subsidy Scheme for 2 More Years',
    excerpt: 'The central government has extended the FAME-III scheme with an enhanced subsidy of ₹50,000 on electric two-wheelers and ₹1.5 lakh on electric four-wheelers, aimed at boosting EV adoption across India.',
    author: 'Amit Desai', authorAvatar: 'AD', date: '3 Jul 2026', readTime: '5 min read',
    tag: 'Policy', tagColor: 'purple', image: 'list',
  },
  {
    id: 4, category: 'News',
    title: 'Hyundai Creta Electric Gets Over 50,000 Bookings in 30 Days',
    excerpt: 'Hyundai India has announced that the Creta Electric has crossed 50,000 bookings within just 30 days of its launch, making it the fastest-selling electric SUV in India. Deliveries are expected to begin next month.',
    author: 'Sneha Kulkarni', authorAvatar: 'SK', date: '2 Jul 2026', readTime: '3 min read',
    tag: 'Sales', tagColor: 'gold', image: 'trending-up',
  },
  {
    id: 5, category: 'News',
    title: 'Mahindra XEV 9e India Price Revealed: Starts at ₹21.9L',
    excerpt: 'Mahindra has officially revealed India pricing for the XEV 9e electric SUV. The base variant starts at ₹21.9 lakh and goes up to ₹28.9 lakh for the fully loaded version. Bookings are now open.',
    author: 'Vikram Joshi', authorAvatar: 'VJ', date: '1 Jul 2026', readTime: '4 min read',
    tag: 'Launch', tagColor: 'red', image: 'rocket',
  },

  // ── EXPERT REVIEWS ──────────────────────────────────────────────────────────
  {
    id: 6, category: 'Expert Review', featured: true, carModel: 'Tata Nexon EV', rating: 4.5,
    title: 'Tata Nexon EV Max Review: The People\'s EV Just Got Better',
    excerpt: 'We spent a week with the Nexon EV Max and came away thoroughly impressed. The 437 km claimed range translates to a solid 380 km in real-world mixed driving. ADAS works reliably in highway conditions. At ₹17L, it remains the benchmark value EV in India.',
    author: 'Karthik Menon', authorAvatar: 'KM', date: '30 Jun 2026', readTime: '12 min read',
    tag: 'EV Review', tagColor: 'green', image: 'battery',
  },
  {
    id: 7, category: 'Expert Review', carModel: 'Maruti Suzuki Grand Vitara Hybrid', rating: 4.2,
    title: 'Grand Vitara Strong Hybrid: 28 km/l in City — Does It Deliver?',
    excerpt: 'Maruti\'s strong hybrid promises segment-leading efficiency. We tested it across Mumbai traffic and highway runs. The e-CVT is seamless, the EV mode handles low-speed crawls well, and the 27.97 km/l ARAI figure is achievable in real conditions with careful driving.',
    author: 'Deepa Iyer', authorAvatar: 'DI', date: '28 Jun 2026', readTime: '10 min read',
    tag: 'Hybrid', tagColor: 'blue', image: 'settings',
  },
  {
    id: 8, category: 'Expert Review', carModel: 'Mahindra Scorpio-N Z8L', rating: 4.6,
    title: 'Scorpio-N Z8L Long-Term Review: 15,000 km Later',
    excerpt: 'After 15,000 km with the Scorpio-N Z8L diesel, here\'s our verdict. Reliability has been excellent with zero unscheduled visits to the service centre. Ride quality improved after the 5,000 km mark. Highway mileage settled at 14.2 km/l — impressive for a big diesel SUV.',
    author: 'Rohan Bhat', authorAvatar: 'RB', date: '25 Jun 2026', readTime: '15 min read',
    tag: 'Long-Term', tagColor: 'purple', image: 'flag',
  },
  {
    id: 9, category: 'Expert Review', carModel: 'Kia Seltos X-Line', rating: 4.3,
    title: 'Kia Seltos X-Line: Style Over Substance or Both?',
    excerpt: 'The blacked-out X-Line looks menacing and we love it. Under the hood it\'s the familiar 1.5T petrol making 160 PS. The 6-speed DCT shifts are snappy, ADAS Level 2 works well on highways, and the panoramic sunroof is the best in segment. But is the ₹20L price tag justified?',
    author: 'Ananya Pillai', authorAvatar: 'AP', date: '22 Jun 2026', readTime: '9 min read',
    tag: 'First Drive', tagColor: 'gold', image: 'gauge',
  },

  // ── USER REVIEWS ────────────────────────────────────────────────────────────
  {
    id: 10, category: 'User Review', carModel: 'Maruti Suzuki Swift ZXi+', rating: 5, featured: true,
    title: 'Swift ZXi+ — 2 Years, 40,000 km: Zero Issues!',
    excerpt: 'Bought the Swift ZXi+ AMT in May 2024 and crossed 40,000 km last month. Not a single unscheduled workshop visit. Average mileage in Bangalore city traffic is 18.5 km/l. The AMT gearbox has only gotten smoother. Service costs are very reasonable — ₹4,200 for the last service.',
    author: 'Sanjay R.', authorAvatar: 'SR', date: '4 Jul 2026', readTime: '5 min read',
    tag: 'Ownership', tagColor: 'green', image: 'user',
  },
  {
    id: 11, category: 'User Review', carModel: 'Hyundai Creta SX(O) Diesel', rating: 4,
    title: 'Creta Diesel: Best Highway Cruiser Under ₹18L',
    excerpt: 'Driving from Delhi to Jaipur every week for work. The Creta diesel 1.5 crU maintains 110 kmph effortlessly and returns 21 km/l on the expressway. NVH levels are acceptable post 5,000 km. Only complaint: stiff rear suspension makes pothole riding uncomfortable.',
    author: 'Gaurav M.', authorAvatar: 'GM', date: '3 Jul 2026', readTime: '4 min read',
    tag: 'Ownership', tagColor: 'blue', image: 'user',
  },
  {
    id: 12, category: 'User Review', carModel: 'Tata Punch EV', rating: 4,
    title: 'Punch EV as Daily Driver: 6 Month Update from Hyderabad',
    excerpt: 'Charging at home overnight on a 7.2 kW wallbox. Daily commute is 35 km and I charge 3 times a week max. TPEM app is useful for remote AC pre-cooling. One issue: regenerative braking tuning could be more aggressive for stop-go Hyderabad traffic.',
    author: 'Lalitha K.', authorAvatar: 'LK', date: '2 Jul 2026', readTime: '6 min read',
    tag: 'EV Life', tagColor: 'green', image: 'zap',
  },
  {
    id: 13, category: 'User Review', carModel: 'Toyota Innova Crysta GX MT', rating: 5,
    title: 'Innova Crysta: 3 Lakh km Club — Still Going Strong',
    excerpt: 'Our 2019 Crysta just crossed 3,00,000 km with the original engine and gearbox. Major service every 10,000 km, timing belt at 1.5L km. The diesel motor is a legend. Running cost: ₹2.8 per km all-inclusive. This car has paid for itself many times over.',
    author: 'Thomas P.', authorAvatar: 'TP', date: '30 Jun 2026', readTime: '8 min read',
    tag: 'Long-Term', tagColor: 'gold', image: 'user',
  },

  // ── SPECIAL REPORTS ─────────────────────────────────────────────────────────
  {
    id: 14, category: 'Special Report', featured: true,
    title: 'India EV Charging Infrastructure Report 2026: City-Wise Analysis',
    excerpt: 'A comprehensive analysis of public EV charging availability across 20 Indian cities. Mumbai leads with 1,240 fast chargers, followed by Delhi (980) and Bangalore (870). Tier-2 cities remain critically underserved. We map the gaps and recommend routes for long-distance EV travel.',
    author: 'GAADIIQ Research', authorAvatar: 'GR', date: '1 Jul 2026', readTime: '20 min read',
    tag: 'EV Infrastructure', tagColor: 'green', image: 'bar-chart',
  },
  {
    id: 15, category: 'Special Report',
    title: 'True Cost of Ownership: Petrol vs Diesel vs CNG vs EV Over 5 Years',
    excerpt: 'We calculated the complete 5-year ownership cost for 4 popular cars across fuel types: Swift Petrol, Amaze Diesel, WagonR CNG, and Nexon EV. Factoring EMI, fuel, insurance, maintenance and resale — the results may surprise you. EV wins in high-usage scenarios.',
    author: 'GAADIIQ Analytics', authorAvatar: 'GA', date: '28 Jun 2026', readTime: '18 min read',
    tag: 'Cost Analysis', tagColor: 'purple', image: 'indian-rupee',
  },
  {
    id: 16, category: 'Special Report',
    title: 'Best Used Cars Under ₹10L in 2026: 50 Cars Analysed',
    excerpt: 'Our data team analysed 50 used car models across price, reliability, spare parts availability, resale trajectory, and owner satisfaction scores. Maruti Suzuki dominates the top 5 for reliability, while Hyundai leads in feature-to-price ratio.',
    author: 'GAADIIQ Team', authorAvatar: 'GT', date: '20 Jun 2026', readTime: '25 min read',
    tag: 'Buyer\'s Guide', tagColor: 'gold', image: 'trophy',
  },
];

const TABS = ['All', 'News', 'Expert Review', 'User Review', 'Special Report'] as const;
type Tab = typeof TABS[number];

const CATEGORY_SLUGS: Record<string, Tab> = {
  'news': 'News',
  'expert-reviews': 'Expert Review',
  'user-reviews': 'User Review',
  'special-reports': 'Special Report',
};

export const CATEGORY_META = [
  { slug: 'news',           label: 'News',           icon: 'newspaper', desc: 'Breaking news, launches & industry updates',  color: 'blue',   count: ARTICLES.filter(a => a.category === 'News').length },
  { slug: 'expert-reviews', label: 'Expert Reviews', icon: 'gauge', desc: 'In-depth tests & long-term ownership reports', color: 'purple', count: ARTICLES.filter(a => a.category === 'Expert Review').length },
  { slug: 'user-reviews',   label: 'User Reviews',   icon: 'user', desc: 'Real owner stories & honest experiences',      color: 'green',  count: ARTICLES.filter(a => a.category === 'User Review').length },
  { slug: 'special-reports',label: 'Special Reports',icon: 'bar-chart', desc: 'Data-driven guides, cost analysis & research', color: 'gold',   count: ARTICLES.filter(a => a.category === 'Special Report').length },
];

@Component({
  selector: 'app-reviews-news',
  standalone: true,
  imports: [CommonModule, RouterLink, IconComponent],
  templateUrl: './reviews-news.component.html',
  styleUrl: './reviews-news.component.scss',
})
export class ReviewsNewsComponent {
  readonly tabs = TABS;
  readonly categoryMeta = CATEGORY_META;

  activeTab = signal<Tab>('All');
  searchQuery = signal('');
  isHub = signal(true);
  isNewsPage = signal(false);

  featured = ARTICLES.filter(a => a.featured);

  readonly slugMap: Record<string, string> = {
    'News': 'news',
    'Expert Review': 'expert-reviews',
    'User Review': 'user-reviews',
    'Special Report': 'special-reports',
  };

  // Live news (GNews API)
  liveArticles = this.news.articles;
  liveLoading = this.news.loading;
  liveError = this.news.error;
  hasApiKey = this.news.hasApiKey;

  articles = computed(() => {
    const tab = this.activeTab();
    const q = this.searchQuery().toLowerCase();
    return ARTICLES.filter(a => {
      const tabMatch = tab === 'All' || a.category === tab;
      const qMatch = !q || a.title.toLowerCase().includes(q) || a.excerpt.toLowerCase().includes(q) || (a.carModel || '').toLowerCase().includes(q);
      return tabMatch && qMatch;
    });
  });

  counts = computed(() => {
    const out: Record<string, number> = { All: ARTICLES.length };
    for (const t of TABS.slice(1)) out[t] = ARTICLES.filter(a => a.category === t).length;
    return out;
  });

  stars(n: number) { return Array.from({ length: 5 }, (_, i) => i < Math.floor(n) ? '★' : i < n ? '½' : '☆'); }

  tagClass(color: string) {
    const map: Record<string, string> = { green: 'tag-green', blue: 'tag-blue', purple: 'tag-purple', gold: 'tag-gold', red: 'tag-red' };
    return map[color] || 'tag-blue';
  }

  categoryBadgeClass(color: string) {
    return `cat-card-${color}`;
  }

  constructor(seo: SeoService, route: ActivatedRoute, public news: NewsService) {
    route.params.subscribe(params => {
      const slug = params['category'];
      if (slug && CATEGORY_SLUGS[slug]) {
        this.isHub.set(false);
        this.activeTab.set(CATEGORY_SLUGS[slug]);
        this.isNewsPage.set(slug === 'news');
        if (slug === 'news') this.news.fetchNews('India car automobile launch EV');
        seo.setPage(CATEGORY_SLUGS[slug], `${CATEGORY_SLUGS[slug]} articles on GAADIIQ`);
      } else {
        this.isHub.set(true);
        this.isNewsPage.set(false);
        this.activeTab.set('All');
        seo.setPage('Reviews & News', 'Latest car news, expert reviews, user stories and special reports from GAADIIQ.');
      }
    });
  }
}
