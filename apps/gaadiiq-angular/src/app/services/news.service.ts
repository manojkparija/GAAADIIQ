import { Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';

export interface NewsArticle {
  id: string;
  title: string;
  description: string;
  url: string;
  image: string | null;
  publishedAt: string;
  source: { name: string; url: string };
}

interface Rss2JsonItem {
  title: string;
  link: string;
  pubDate: string;
  author: string;
  thumbnail: string;
  description: string;
  content: string;
}

interface Rss2JsonResponse {
  status: string;
  feed: { title: string; link: string; image: string };
  items: Rss2JsonItem[];
}

// Google News RSS → rss2json proxy (free, no API key, 10k req/month)
const RSS2JSON = 'https://api.rss2json.com/v1/api.json';
const GOOGLE_NEWS_RSS = 'https://news.google.com/rss/search?q={QUERY}&hl=en-IN&gl=IN&ceid=IN:en';

@Injectable({ providedIn: 'root' })
export class NewsService {
  readonly articles = signal<NewsArticle[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly hasApiKey: boolean = true;

  constructor(private http: HttpClient) {}

  fetchNews(query = 'India car automobile EV launch', maxResults = 12) {
    this.loading.set(true);
    this.error.set(null);

    const rssUrl = GOOGLE_NEWS_RSS.replace('{QUERY}', encodeURIComponent(query));
    const url = `${RSS2JSON}?rss_url=${encodeURIComponent(rssUrl)}&count=${maxResults}`;

    this.http.get<Rss2JsonResponse>(url).subscribe({
      next: res => {
        if (res.status !== 'ok') {
          this.error.set('Could not load live news. Showing curated articles instead.');
          this.articles.set([]);
        } else {
          this.articles.set(res.items.map((item, i) => ({
            id: `live-${i}`,
            title: this.cleanTitle(item.title),
            description: this.stripHtml(item.description || item.content || ''),
            url: item.link,
            image: item.thumbnail || null,
            publishedAt: item.pubDate,
            source: { name: 'Google News', url: '' },
          })));
        }
        this.loading.set(false);
      },
      error: () => {
        this.error.set('Could not load live news. Showing curated articles instead.');
        this.articles.set([]);
        this.loading.set(false);
      },
    });
  }

  formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  // Strip " - SiteName" or " | SiteName" suffixes Google News appends to titles
  private cleanTitle(title: string): string {
    return title
      .replace(/\s[-–|]\s[^-–|]+$/, '')
      .trim();
  }

  private stripHtml(html: string): string {
    return html.replace(/<[^>]*>/g, '').replace(/&[a-z]+;/gi, ' ').trim().slice(0, 300);
  }
}
