import { Injectable, signal } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { environment } from '../../environments/environment';

export interface NewsArticle {
  id: string;
  title: string;
  description: string;
  url: string;
  image: string | null;
  publishedAt: string;
  source: { name: string; url: string };
}

interface NewsApiArticle {
  id: string;
  title: string;
  description: string;
  url: string;
  image: string | null;
  publishedAt: string;
  source: string;
}

interface NewsApiResponse {
  query: string;
  count: number;
  articles: NewsApiArticle[];
}

/**
 * Live car news, fetched through our own API.
 *
 * This used to call api.rss2json.com directly from the browser, which called
 * Google News. That sent every visitor's IP and search terms to a third party
 * with no agreement in place, ran on a 10k/month quota shared by all users with
 * no key to rotate or throttle — which is why the page had been showing
 * "Could not load live news" — and cached nothing.
 *
 * The API now fetches the feed itself, so the browser only ever talks to our
 * own origin. Note there is no Authorization header here: the auth interceptor
 * attaches the Supabase token to anything aimed at environment.apiUrl, and
 * setting one by hand would shadow it.
 */
@Injectable({ providedIn: 'root' })
export class NewsService {
  readonly articles = signal<NewsArticle[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  constructor(private http: HttpClient) {}

  fetchNews(query = '', maxResults = 12) {
    this.loading.set(true);
    this.error.set(null);

    const params = new HttpParams()
      .set('q', query ?? '')
      .set('limit', String(maxResults));

    this.http.get<NewsApiResponse>(`${environment.apiUrl}/news`, { params }).subscribe({
      next: res => {
        this.articles.set((res.articles ?? []).map(item => ({
          id: item.id,
          title: item.title,
          description: item.description,
          url: item.url,
          image: item.image,
          publishedAt: item.publishedAt,
          // The publisher, not "Google News": it is the name a reader needs to
          // judge the headline, and the API now returns it per article.
          source: { name: item.source, url: '' },
        })));
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
    const parsed = new Date(iso);
    // RSS dates are RFC-822 ("Tue, 11 Aug 2026 09:12:00 GMT"). Browsers parse
    // that, but an unparseable one must not render as "Invalid Date".
    if (isNaN(parsed.getTime())) return '';
    return parsed.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  }
}
