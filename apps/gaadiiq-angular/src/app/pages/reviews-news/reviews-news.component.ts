import { Component, signal, computed, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, ActivatedRoute } from '@angular/router';
import { SeoService } from '../../services/seo.service';
import { NewsService } from '../../services/news.service';
import { IconComponent } from '../../components/icon/icon.component';
import { TranslatePipe } from '../../pipes/translate.pipe';

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

// Search pacing, set from what production actually did rather than a guess.
//
// At 400ms, typing "TATA CAR LAUNCH DATE" produced FIVE separate fetches of
// Google News — one per word, because an ordinary pause between words clears a
// 400ms timer. Each distinct query is a cache miss server-side, so every
// fragment became a real upstream request, including "TATA CAR LAU".
//
// 900ms is longer than the gap between words and shorter than the gap after
// finishing a thought, which is the distinction that matters here.
const SEARCH_DEBOUNCE_MS = 900;

// A prefix this short is a fragment, not a search.
const SEARCH_MIN_CHARS = 4;

/**
 * Hand-written articles.
 *
 * Empty, deliberately. This array used to hold sixteen entries — five news
 * stories, four expert reviews, four owner reviews and three special reports —
 * none of which anyone wrote. They carried invented bylines ("Rahul Sharma",
 * "Priya Nair"), star ratings, read times and future dates, and their text
 * asserted work that was never done:
 *
 *   "We tested it across Mumbai traffic and highway runs"
 *   "We spent a week with the Nexon EV Max"
 *   "based on primary data collected across multiple Indian cities"
 *
 * A reader cannot tell that from reporting, which is the whole problem: those
 * are exactly the claims someone acts on when deciding what to buy. Presenting
 * them as published journalism under a named author is not a placeholder, it is
 * a false statement about a car with a price attached.
 *
 * Every category now runs on the live feed instead — real headlines from real
 * publishers, each linked back to the publisher who wrote it. When GAADIIQ has
 * its own editorial output, it goes here with a real author against it.
 */
export const ARTICLES: Article[] = [];

const TABS = ['All', 'News', 'Expert Review', 'User Review', 'Special Report'] as const;
type Tab = typeof TABS[number];

const CATEGORY_SLUGS: Record<string, Tab> = {
  'news': 'News',
  'expert-reviews': 'Expert Review',
  'user-reviews': 'User Review',
  'special-reports': 'Special Report',
};

/**
 * The four sections, each with the search that fills it.
 *
 * `query` goes to our own /news endpoint, which asks Google News and caches the
 * answer. Every category is a live feed now rather than a fixed list, so a
 * section is as current as the publishers are — and nothing in it was written
 * here.
 *
 * There is no `count`: the number of stories is whatever the feed returned this
 * minute, so a number baked in at build time would be decoration.
 */
export const CATEGORY_META = [
  {
    slug: 'news', label: 'News', icon: 'newspaper', color: 'blue',
    desc: 'Breaking news, launches & industry updates',
    query: '',   // blank = the endpoint's default India car/EV feed
  },
  {
    slug: 'expert-reviews', label: 'Expert Reviews', icon: 'gauge', color: 'purple',
    desc: 'Road tests and first drives, from the publications that ran them',
    query: 'car review road test first drive India',
  },
  {
    slug: 'user-reviews', label: 'User Reviews', icon: 'user', color: 'green',
    desc: 'Ownership reports and long-term experiences',
    query: 'car ownership review long term India owner',
  },
  {
    slug: 'special-reports', label: 'Special Reports', icon: 'bar-chart', color: 'gold',
    desc: 'Sales data, cost analysis and buying guides',
    query: 'car sales report buying guide cost analysis India',
  },
];

@Component({
  selector: 'app-reviews-news',
  standalone: true,
  imports: [CommonModule, RouterLink, IconComponent, TranslatePipe],
  templateUrl: './reviews-news.component.html',
  styleUrl: './reviews-news.component.scss',
})
export class ReviewsNewsComponent implements OnDestroy {
  readonly tabs = TABS;
  readonly categoryMeta = CATEGORY_META;

  activeTab = signal<Tab>('All');
  searchQuery = signal('');
  isHub = signal(true);
  isNewsPage = signal(false);

  featured = ARTICLES.filter(a => a.featured);

  /**
   * The feed query behind the category currently open.
   *
   * Kept so that clearing the search box returns to the category's own feed
   * rather than the site-wide default — clearing a search on Expert Reviews
   * should not silently leave you looking at general news.
   */
  categoryQuery = signal('');

  /** The slug of the open category, so live cards link back into it. */
  categorySlug = signal('news');

  /** The open category's one-line description, shown under its title. */
  categoryDesc = computed(
    () => CATEGORY_META.find(c => c.slug === this.categorySlug())?.desc ?? '',
  );

  readonly slugMap: Record<string, string> = {
    'News': 'news',
    'Expert Review': 'expert-reviews',
    'User Review': 'user-reviews',
    'Special Report': 'special-reports',
  };

  // Live news, fetched through our own API (see services/news.service.ts).
  liveArticles = this.news.articles;
  liveLoading = this.news.loading;
  liveError = this.news.error;

  private searchDebounce?: ReturnType<typeof setTimeout>;

  /**
   * Update the query, and on the News page actually search the news.
   *
   * The box used to filter only the hand-written articles below, so typing a
   * car's name on the News page searched five local entries and reported "no
   * articles found" while live headlines about it went unqueried.
   *
   * Debounced because each distinct query is a fetch on the API and, past the
   * cache, a request to Google News — firing one per keystroke would spend a
   * request on every prefix of what someone is still typing.
   */
  onSearch(value: string) {
    this.searchQuery.set(value);
    if (!this.isNewsPage()) return;

    clearTimeout(this.searchDebounce);

    const query = value.trim();

    // Clearing the box goes straight back to the default feed. That query is
    // always warm in the server's cache, so there is nothing to wait for.
    if (!query) {
      this.news.fetchNews(this.categoryQuery());
      return;
    }

    // Below this, a query is a fragment rather than a search. Production
    // showed "TATA CAR LAU" reaching Google as a real request; a two- or
    // three-letter prefix is worse and returns nothing anyone wanted.
    if (query.length < SEARCH_MIN_CHARS) return;

    this.searchDebounce = setTimeout(() => this.news.fetchNews(query), SEARCH_DEBOUNCE_MS);
  }

  ngOnDestroy() {
    // A pending timer would otherwise fire a fetch into a destroyed component.
    clearTimeout(this.searchDebounce);
  }

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

  /**
   * A CSS background-image value for a thumbnail URL from the feed.
   *
   * The template used to build this by concatenation:
   *
   *     [style.backgroundImage]="a.image ? 'url(' + a.image + ')' : 'none'"
   *
   * That pastes third-party text straight into a CSS value. A URL containing a
   * closing parenthesis ends the url() early and everything after it is parsed
   * as further CSS — so the provider, not us, decides what declarations land on
   * the element. Angular escapes interpolation into the DOM; it does not parse
   * a string we assembled ourselves into CSS.
   *
   * So: require https (the API enforces this too — this is the second layer,
   * not the only one), percent-encode the URL so no character can terminate
   * the function, and wrap it in quotes. A value that fails returns 'none' and
   * the card falls back to its icon, which is a visible, harmless outcome.
   */
  thumb(image: string | null): string {
    if (!image || !/^https:\/\//i.test(image)) return 'none';
    try {
      // encodeURI leaves '(' ')' and "'" alone, so escape those explicitly.
      const safe = encodeURI(image)
        .replace(/\(/g, '%28')
        .replace(/\)/g, '%29')
        .replace(/'/g, '%27')
        .replace(/"/g, '%22');
      return `url('${safe}')`;
    } catch {
      // encodeURI throws on a lone surrogate.
      return 'none';
    }
  }

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
        // Every category is a live feed now, not just News.
        this.isNewsPage.set(true);
        this.searchQuery.set('');
        this.categorySlug.set(slug);
        const meta = CATEGORY_META.find(c => c.slug === slug);
        this.categoryQuery.set(meta?.query ?? '');
        this.news.fetchNews(this.categoryQuery());
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
