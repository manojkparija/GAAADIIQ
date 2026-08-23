import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { IconComponent } from '../../components/icon/icon.component';
import { TranslatePipe } from '../../pipes/translate.pipe';
import { AuthService } from '../../services/auth.service';
import { CarsDataService, Car } from '../../services/cars-data.service';
import { SeoService } from '../../services/seo.service';
import {
  MAX_VIDEO_BYTES,
  VideoReview,
  VideoReviewService,
} from '../../services/video-review.service';

/**
 * Record a video review of a car you own.
 *
 * WHY THIS PAGE IS GATED
 *
 * It is reachable from the main navigation, which makes it the most exposed
 * upload form on the site. An open one would be a public endpoint for putting
 * arbitrary video files on gaadiiq.com — so it requires a signed-in account,
 * and the API requires one too. The check here is for the user's benefit (it
 * says so before they record two minutes of video); the check that matters is
 * the server's, because this one runs on the attacker's machine.
 *
 * NOTHING SUBMITTED HERE IS PUBLIC
 *
 * Every submission is held until someone approves it. The page says so before
 * upload and again after, because a person who has just recorded a review and
 * sees no sign of it will otherwise submit it three more times.
 */
@Component({
  selector: 'app-video-review',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, IconComponent, TranslatePipe],
  templateUrl: './video-review.component.html',
  styleUrl: './video-review.component.scss',
})
export class VideoReviewComponent {
  private readonly api = inject(VideoReviewService);
  private readonly cars = inject(CarsDataService);
  private readonly router = inject(Router);
  readonly auth = inject(AuthService);

  readonly maxBytes = MAX_VIDEO_BYTES;
  readonly maxMb = Math.round(MAX_VIDEO_BYTES / (1024 * 1024));

  // ── The form ───────────────────────────────────────────────────────────────
  carQuery = '';
  selectedCar = signal<Car | null>(null);
  rating = signal(0);
  hoverRating = signal(0);
  title = '';
  body = '';

  videoFile = signal<File | null>(null);
  videoPreview = signal<string | null>(null);

  error = signal<string | null>(null);
  submitted = signal(false);
  readonly uploading = this.api.uploading;

  mine = signal<VideoReview[]>([]);
  loadingMine = signal(false);

  constructor(seo: SeoService) {
    seo.setPage(
      'Post a Video Review',
      'Record a short video review of a car you own. Reviews are checked before they appear.',
    );
    if (this.auth.isLoggedIn()) this.loadMine();
  }

  /**
   * Catalogue matches for what has been typed.
   *
   * A method, not a computed(): `carQuery` is a plain field bound with ngModel,
   * and computed() tracks signal reads only — over a plain field it evaluates
   * once and is stale for ever. CLAUDE.md records that having shipped twice.
   */
  carMatches(): Car[] {
    const q = this.carQuery.trim().toLowerCase();
    if (q.length < 2) return [];
    return this.cars
      .getAll()
      .filter(c => `${c.make} ${c.model} ${c.variant ?? ''} ${c.year}`.toLowerCase().includes(q))
      .slice(0, 8);
  }

  carLabel(c: Car): string {
    return [c.make, c.model, c.variant, c.year].filter(Boolean).join(' ');
  }

  pickCar(c: Car) {
    this.selectedCar.set(c);
    this.carQuery = '';
    this.error.set(null);
  }

  clearCar() {
    this.selectedCar.set(null);
  }

  setRating(n: number) {
    this.rating.set(n);
    this.error.set(null);
  }

  onVideoSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    // Checked here so someone does not wait out a 50 MB upload to be told no.
    // The server checks again, and by the bytes rather than the name — this
    // check runs on the uploader's machine and proves nothing.
    if (file.size > MAX_VIDEO_BYTES) {
      this.error.set(
        `That video is ${(file.size / (1024 * 1024)).toFixed(0)} MB. The limit is ${this.maxMb} MB — ` +
        `please trim it or record at a lower quality.`,
      );
      this.videoFile.set(null);
      this.videoPreview.set(null);
      return;
    }

    this.revokePreview();
    this.videoFile.set(file);
    this.videoPreview.set(URL.createObjectURL(file));
    this.error.set(null);
  }

  clearVideo() {
    this.revokePreview();
    this.videoFile.set(null);
    this.videoPreview.set(null);
  }

  private revokePreview() {
    const url = this.videoPreview();
    if (url) URL.revokeObjectURL(url);
  }

  canSubmit = computed(
    () => !!this.selectedCar() && this.rating() > 0 && !!this.videoFile() && !this.uploading(),
  );

  /** Names what is actually missing, rather than listing every field. */
  private missing(): string[] {
    const out: string[] = [];
    if (!this.selectedCar()) out.push('the car you are reviewing');
    if (!this.rating()) out.push('a star rating');
    if (!this.videoFile()) out.push('a video');
    return out;
  }

  async submit() {
    if (this.uploading()) return;

    const gaps = this.missing();
    if (gaps.length) {
      const list = gaps.length > 1
        ? `${gaps.slice(0, -1).join(', ')} and ${gaps[gaps.length - 1]}`
        : gaps[0];
      this.error.set(`Please add ${list}.`);
      return;
    }

    this.error.set(null);
    const car = this.selectedCar()!;
    try {
      await this.api.submit({
        carId: car.id,
        carLabel: this.carLabel(car),
        rating: this.rating(),
        title: this.title,
        body: this.body,
        video: this.videoFile()!,
      });
      this.submitted.set(true);
      this.resetForm();
      await this.loadMine();
    } catch (err: any) {
      // The API's message where there is one — it says which limit was hit,
      // and "something went wrong" helps nobody re-record a video.
      const detail = err?.error?.detail;
      this.error.set(
        typeof detail === 'string'
          ? detail
          : 'We could not upload that just now. Please check your connection and try again.',
      );
    }
  }

  private resetForm() {
    this.clearVideo();
    this.selectedCar.set(null);
    this.rating.set(0);
    this.title = '';
    this.body = '';
    this.carQuery = '';
  }

  async loadMine() {
    this.loadingMine.set(true);
    try {
      this.mine.set(await this.api.mine());
    } catch {
      // Not surfaced: failing to list past submissions must not look like the
      // upload form is broken.
      this.mine.set([]);
    } finally {
      this.loadingMine.set(false);
    }
  }

  async withdraw(id: string) {
    try {
      await this.api.remove(id);
      this.mine.update(list => list.filter(r => r.id !== id));
    } catch {
      this.error.set('We could not remove that review. Please try again.');
    }
  }

  signIn() {
    this.router.navigate(['/login'], { queryParams: { redirect: '/video-review' } });
  }

  statusLabel(s: string): string {
    return {
      pending: 'Awaiting review',
      approved: 'Published',
      rejected: 'Not published',
      withdrawn: 'Withdrawn',
    }[s] ?? s;
  }

  stars(n: number) {
    return Array.from({ length: 5 }, (_, i) => (i < n ? '★' : '☆'));
  }
}
