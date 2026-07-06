import { Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';

export interface NewsArticle {
  title: string;
  description: string;
  url: string;
  image: string | null;
  publishedAt: string;
  source: { name: string; url: string };
}

interface GNewsResponse {
  totalArticles: number;
  articles: NewsArticle[];
}

// Get a free key at https://gnews.io — 100 req/day free tier
const GNEWS_API_KEY = '943f97bb47d0adb1a67b6ee871a2ded0';

@Injectable({ providedIn: 'root' })
export class NewsService {
  readonly articles = signal<NewsArticle[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly hasApiKey = GNEWS_API_KEY !== 'YOUR_GNEWS_API_KEY';

  constructor(private http: HttpClient) {}

  fetchNews(query = 'India car automobile', maxResults = 10) {
    if (!this.hasApiKey) return;

    this.loading.set(true);
    this.error.set(null);

    const url = `https://gnews.io/api/v4/search?q=${encodeURIComponent(query)}&lang=en&country=in&max=${maxResults}&apikey=${GNEWS_API_KEY}`;

    this.http.get<GNewsResponse>(url).subscribe({
      next: res => {
        this.articles.set(res.articles ?? []);
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
}
