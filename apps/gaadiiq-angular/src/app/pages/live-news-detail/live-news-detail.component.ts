import { Component, OnDestroy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, ActivatedRoute } from '@angular/router';
import { NewsService, NewsArticle } from '../../services/news.service';
import { SeoService } from '../../services/seo.service';
import { IconComponent } from '../../components/icon/icon.component';
import { TranslatePipe } from '../../pipes/translate.pipe';

/**
 * One live news item: headline, publisher, date, and a link to the real story.
 *
 * The page deliberately holds no prose of its own. It previously carried two
 * hardcoded sections presented as analysis of whichever article you had opened
 * — the same four "Key Highlights" and the same two paragraphs of "What This
 * Means for Indian Buyers" under every headline. Nothing marked them as
 * boilerplate, so they read as reporting about that specific story.
 *
 * The feed gives us a headline, a publisher, a timestamp and a URL. Anything
 * beyond that would be invention, and on a site people use to decide what car
 * to buy, invented commentary is worse than a short page.
 */
@Component({
  selector: 'app-live-news-detail',
  standalone: true,
  imports: [CommonModule, RouterLink, IconComponent, TranslatePipe],
  templateUrl: './live-news-detail.component.html',
  styleUrl: './live-news-detail.component.scss',
})
export class LiveNewsDetailComponent implements OnDestroy {
  article = signal<NewsArticle | null>(null);

  /**
   * True once the refetch has been and gone without finding the item.
   *
   * Without this the page said "Loading article…" forever when the index no
   * longer resolved — a dead end that looks like a hang rather than a miss.
   */
  loadFailed = signal(false);

  private retryTimer?: ReturnType<typeof setTimeout>;

  constructor(route: ActivatedRoute, public news: NewsService, seo: SeoService) {
    route.params.subscribe(params => {
      const idx = Number(params['index']);
      this.loadFailed.set(false);

      const found = this.news.articles()[idx] ?? null;
      this.article.set(found);
      if (found) {
        seo.setPage(found.title, found.description);
        return;
      }

      // A refresh lands here with an empty service, so refetch and look again.
      this.news.fetchNews();
      clearTimeout(this.retryTimer);
      this.retryTimer = setTimeout(() => {
        const refreshed = this.news.articles()[idx] ?? null;
        this.article.set(refreshed);
        if (refreshed) seo.setPage(refreshed.title, refreshed.description);
        else this.loadFailed.set(true);
      }, 2000);
    });
  }

  ngOnDestroy() {
    clearTimeout(this.retryTimer);
  }
}
