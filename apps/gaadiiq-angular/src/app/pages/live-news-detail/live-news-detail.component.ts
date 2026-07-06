import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, ActivatedRoute } from '@angular/router';
import { NewsService, NewsArticle } from '../../services/news.service';
import { SeoService } from '../../services/seo.service';

@Component({
  selector: 'app-live-news-detail',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './live-news-detail.component.html',
  styleUrl: './live-news-detail.component.scss',
})
export class LiveNewsDetailComponent {
  article = signal<NewsArticle | null>(null);

  constructor(route: ActivatedRoute, public news: NewsService, seo: SeoService) {
    route.params.subscribe(params => {
      const idx = Number(params['index']);
      const all = this.news.articles();
      const found = all[idx] ?? null;
      this.article.set(found);
      if (found) seo.setPage(found.title, found.description);

      // If service was reset (e.g. page refresh), refetch then pick item
      if (!found) {
        this.news.fetchNews();
        const sub = this.news.articles.subscribe?.(() => {});
        // Poll once after fetch completes
        setTimeout(() => {
          const refreshed = this.news.articles()[idx] ?? null;
          this.article.set(refreshed);
          if (refreshed) seo.setPage(refreshed.title, refreshed.description);
        }, 2000);
      }
    });
  }
}
