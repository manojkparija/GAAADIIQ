import { Component, computed, effect, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, ActivatedRoute } from '@angular/router';
import { NewsService } from '../../services/news.service';
import { SeoService } from '../../services/seo.service';
import { CATEGORY_META } from '../reviews-news/reviews-news.component';
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
 *
 * THE URL NAMES THE STORY, NOT A POSITION IN THE FEED
 *
 * The route parameter used to be the article's index in whatever the feed had
 * returned that minute. Google News reorders continuously, so a link that was
 * shared, bookmarked or indexed resolved against a different feed and opened a
 * *different* story — measured: the same URL served "A headline 2" from one
 * feed and "B headline 2" from the next, with nothing on the page indicating
 * the substitution. Sending a reader to a story that is not the one they were
 * sent is worse than sending them nowhere.
 *
 * It is now the id the API derives from the story's own URL
 * (services/news_feed.py::article_id), so the link either finds the story it
 * names or honestly reports that it has aged out of the feed.
 */
@Component({
  selector: 'app-live-news-detail',
  standalone: true,
  imports: [CommonModule, RouterLink, IconComponent, TranslatePipe],
  templateUrl: './live-news-detail.component.html',
  styleUrl: './live-news-detail.component.scss',
})
export class LiveNewsDetailComponent {
  /** The story this URL names. */
  private wantedId = signal<string | null>(null);

  /** The category the link came from, so "back" returns where it should. */
  categorySlug = signal('news');

  /** True once we have asked the feed for this story and not merely looked. */
  private refetched = signal(false);

  article = computed(() => {
    const id = this.wantedId();
    if (!id) return null;
    return this.news.articles().find(a => a.id === id) ?? null;
  });

  /**
   * The feed answered, and the story is not in it.
   *
   * Gated on the request having actually settled rather than on a timer. The
   * previous version waited a fixed 2000ms and then declared the story gone —
   * measured: a feed that answered successfully after 3.5s left a perfectly
   * valid link reading "That story is no longer in the feed", because the
   * articles landed a second after the timer had already given up and nothing
   * looked again. The API runs WEB_CONCURRENCY=1 and an uncached Google News
   * query is the slowest request on the site, so that is an ordinary timing,
   * not a pathological one.
   */
  loadFailed = computed(
    () => this.refetched() && !this.news.loading() && !this.news.error() && !this.article(),
  );

  /** The feed itself could not be reached — a different fact from "aged out". */
  fetchFailed = computed(() => this.refetched() && !this.news.loading() && !!this.news.error());

  constructor(route: ActivatedRoute, public news: NewsService, seo: SeoService) {
    effect(() => {
      const found = this.article();
      if (found) seo.setPage(found.title, found.description);
    });

    route.params.subscribe(params => {
      const slug = params['category'] ?? 'news';
      this.categorySlug.set(slug);
      this.wantedId.set(String(params['id'] ?? ''));
      this.refetched.set(false);

      if (this.article()) return;

      // A refresh, a shared link or a search-engine visit lands here with an
      // empty service, so ask this category's feed and look again. It has to
      // be THIS category's query: each section runs its own search, and an id
      // from one feed is not in another.
      const meta = CATEGORY_META.find(c => c.slug === slug);
      this.refetched.set(true);
      this.news.fetchNews(meta?.query ?? '');
    });
  }

  /** Ask the feed again, for the banner's retry. */
  retry() {
    const meta = CATEGORY_META.find(c => c.slug === this.categorySlug());
    this.refetched.set(true);
    this.news.fetchNews(meta?.query ?? '');
  }
}
