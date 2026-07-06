import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, ActivatedRoute } from '@angular/router';
import { SeoService } from '../../services/seo.service';
import { ARTICLES, Article } from '../reviews-news/reviews-news.component';

@Component({
  selector: 'app-article-detail',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './article-detail.component.html',
  styleUrl: './article-detail.component.scss',
})
export class ArticleDetailComponent {
  article = signal<Article | null>(null);
  categorySlug = signal('');

  readonly SLUG_MAP: Record<string, string> = {
    'News': 'news',
    'Expert Review': 'expert-reviews',
    'User Review': 'user-reviews',
    'Special Report': 'special-reports',
  };

  constructor(route: ActivatedRoute, private seo: SeoService) {
    route.params.subscribe(params => {
      const id = Number(params['id']);
      const found = ARTICLES.find(a => a.id === id) ?? null;
      this.article.set(found);
      this.categorySlug.set(found ? (this.SLUG_MAP[found.category] ?? 'news') : '');
      if (found) seo.setPage(found.title, found.excerpt);
    });
  }

  stars(n: number) {
    return Array.from({ length: 5 }, (_, i) => i < Math.floor(n) ? '★' : i < n ? '½' : '☆');
  }

  tagClass(color: string) {
    const map: Record<string, string> = { green: 'tag-green', blue: 'tag-blue', purple: 'tag-purple', gold: 'tag-gold', red: 'tag-red' };
    return map[color] || 'tag-blue';
  }
}
