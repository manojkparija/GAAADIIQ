import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule, NgOptimizedImage } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Wave3MediaService, SearchResult } from '../../services/wave3-media.service';

@Component({
  selector: 'app-wave3-search',
  standalone: true,
  imports: [CommonModule, FormsModule, NgOptimizedImage],
  template: `
    <div class="wave3-search-container">
      <h2>🔍 Semantic Image Search</h2>
      <p class="wave3-subtitle">Search images using natural language descriptions</p>

      <div class="wave3-search-box">
        <input
          type="text"
          [(ngModel)]="searchQuery"
          (keyup.enter)="search()"
          placeholder="e.g., 'red sedan exterior' or 'interior dashboard view'"
          class="wave3-input"
          [disabled]="isSearching()"
        />
        <button (click)="search()" [disabled]="!searchQuery() || isSearching()" class="wave3-btn-search">
          {{ isSearching() ? '🔍 Searching...' : '🔍 Search' }}
        </button>
      </div>

      @if (error()) {
        <div class="wave3-error">{{ error() }}</div>
      }

      @if (searchResults().length > 0) {
        <div class="wave3-results">
          <h3>Search Results ({{ searchResults().length }})</h3>
          <div class="wave3-grid">
            @for (result of searchResults(); track result.id) {
              <div class="wave3-result-card">
                <img [src]="result.url" [alt]="result.make + ' ' + result.model" class="wave3-result-img" />
                <div class="wave3-result-info">
                  <div class="wave3-result-title">{{ result.make }} {{ result.model }}</div>
                  <div class="wave3-result-meta">
                    @if (result.model_year) {
                      <span>{{ result.model_year }}</span>
                    }
                    @if (result.image_category) {
                      <span>{{ result.image_category }}</span>
                    }
                  </div>
                  <div class="wave3-result-score">
                    Match: {{ (result.similarity_score * 100).toFixed(0) }}%
                  </div>
                </div>
              </div>
            }
          </div>
        </div>
      }

      @if (searchAttempted() && searchResults().length === 0 && !isSearching() && !error()) {
        <div class="wave3-no-results">
          No images found matching your search. Try a different description.
        </div>
      }
    </div>
  `,
  styles: [`
    .wave3-search-container {
      padding: 2rem;
      background: white;
      border-radius: 12px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    }

    h2 {
      margin: 0 0 0.5rem 0;
      color: #1f2937;
      font-size: 1.5rem;
    }

    .wave3-subtitle {
      margin: 0 0 1.5rem 0;
      color: #6b7280;
      font-size: 0.95rem;
    }

    .wave3-search-box {
      display: flex;
      gap: 0.5rem;
      margin-bottom: 1.5rem;
    }

    .wave3-input {
      flex: 1;
      padding: 0.75rem 1rem;
      border: 1px solid #d1d5db;
      border-radius: 6px;
      font-size: 0.95rem;
      transition: border-color 0.2s;

      &:focus {
        outline: none;
        border-color: #3b82f6;
        box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
      }

      &:disabled {
        background: #f3f4f6;
        color: #9ca3af;
      }
    }

    .wave3-btn-search {
      padding: 0.75rem 1.5rem;
      background: #3b82f6;
      color: white;
      border: none;
      border-radius: 6px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
      white-space: nowrap;

      &:hover:not(:disabled) {
        background: #2563eb;
      }

      &:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }
    }

    .wave3-error {
      background: #fee2e2;
      color: #991b1b;
      padding: 1rem;
      border-radius: 6px;
      margin-bottom: 1rem;
    }

    .wave3-results {
      margin-top: 2rem;

      h3 {
        margin: 0 0 1rem 0;
        color: #1f2937;
      }
    }

    .wave3-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
      gap: 1rem;
    }

    .wave3-result-card {
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      overflow: hidden;
      transition: all 0.2s;
      background: white;

      &:hover {
        border-color: #3b82f6;
        box-shadow: 0 4px 12px rgba(59, 130, 246, 0.15);
      }
    }

    .wave3-result-img {
      width: 100%;
      height: 150px;
      object-fit: cover;
      background: #f3f4f6;
    }

    .wave3-result-info {
      padding: 0.75rem;
    }

    .wave3-result-title {
      font-weight: 600;
      color: #1f2937;
      font-size: 0.9rem;
    }

    .wave3-result-meta {
      display: flex;
      gap: 0.5rem;
      font-size: 0.8rem;
      color: #6b7280;
      margin-top: 0.25rem;

      span {
        background: #f3f4f6;
        padding: 0.125rem 0.375rem;
        border-radius: 3px;
      }
    }

    .wave3-result-score {
      font-size: 0.75rem;
      color: #059669;
      font-weight: 600;
      margin-top: 0.5rem;
    }

    .wave3-no-results {
      text-align: center;
      padding: 2rem 1rem;
      color: #6b7280;
      background: #f9fafb;
      border-radius: 8px;
      margin-top: 1rem;
    }
  `]
})
export class Wave3SearchComponent {
  private mediaService = inject(Wave3MediaService);

  searchQuery = signal('');
  searchResults = signal<SearchResult[]>([]);
  isSearching = signal(false);
  error = signal('');
  searchAttempted = signal(false);

  async search() {
    const query = this.searchQuery();
    if (!query.trim()) return;

    this.isSearching.set(true);
    this.error.set('');
    this.searchAttempted.set(true);

    try {
      const results = await this.mediaService.searchImages(query).toPromise();
      this.searchResults.set(results || []);
    } catch (err) {
      this.error.set(`Search failed: ${err}`);
      this.searchResults.set([]);
    } finally {
      this.isSearching.set(false);
    }
  }
}
