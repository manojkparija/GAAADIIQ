import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Video, VideosService, youtubeThumbnailUrl } from '../../services/videos.service';
import { IconComponent } from '../../components/icon/icon.component';

/**
 * Publishing GAADIIQ's own videos to the Reviews & News hub.
 *
 * Paste a YouTube link, give it a title, it appears. Deliberately an admin
 * screen rather than a pull from the YouTube Data API: a channel feed would
 * need a Google API key and quota, and would publish whatever went up on the
 * channel without anyone deciding it belonged on the hub.
 *
 * THE LINK IS NOT PARSED HERE
 *
 * The API extracts the video id and refuses anything that is not one video --
 * a playlist, a channel, a different host. Doing it here as well would be a
 * second implementation to keep in step, and the browser's copy is the one an
 * attacker can skip. The field accepts whatever is pasted and shows the
 * server's reason verbatim when it is refused, because that reason names
 * WHICH part was wrong.
 */
@Component({
  selector: 'app-admin-videos',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent],
  templateUrl: './admin-videos.component.html',
  styleUrls: ['./admin-videos.component.scss'],
})
export class AdminVideosComponent {
  videos = inject(VideosService);

  url = signal('');
  title = signal('');
  description = signal('');
  carLabel = signal('');

  saving = signal(false);
  /** The server's own words. See the class comment. */
  error = signal('');

  constructor() {
    void this.videos.load(true);
  }

  thumb(id: string): string | null { return youtubeThumbnailUrl(id); }

  canSubmit(): boolean {
    return !!this.url().trim() && !!this.title().trim() && !this.saving();
  }

  async add(): Promise<void> {
    if (!this.canSubmit()) return;
    this.saving.set(true);
    this.error.set('');
    const message = await this.videos.add({
      url: this.url().trim(),
      title: this.title().trim(),
      description: this.description().trim() || undefined,
      car_label: this.carLabel().trim() || undefined,
    });
    this.saving.set(false);
    if (message) { this.error.set(message); return; }
    this.url.set('');
    this.title.set('');
    this.description.set('');
    this.carLabel.set('');
  }

  async togglePublished(v: Video): Promise<void> {
    await this.videos.setPublished(v.id, !v.is_published);
  }

  /**
   * Deleting asks first.
   *
   * Unpublishing is the reversible action and is what the row offers first;
   * this one cannot be undone, and the two buttons sit next to each other.
   */
  async remove(v: Video): Promise<void> {
    if (!confirm(`Remove "${v.title}" completely? Unpublishing hides it and keeps the record.`)) return;
    await this.videos.remove(v.id);
  }
}
