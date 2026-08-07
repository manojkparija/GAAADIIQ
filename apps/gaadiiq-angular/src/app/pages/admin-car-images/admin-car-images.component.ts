import {
  Component, signal, computed, inject, OnInit,
  ChangeDetectionStrategy, HostListener,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { SupabaseService } from '../../services/supabase.service';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-admin-car-images',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './admin-car-images.component.html',
  styleUrls: ['./admin-car-images.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminCarImagesComponent implements OnInit {
  auth = inject(AuthService);
  private supabase = inject(SupabaseService);
  private apiUrl = environment.apiUrl;

  // File selection
  dragOver = signal(false);
  selectedFiles = signal<File[]>([]);

  // ── Upload limits ────────────────────────────────────────────────────────
  //
  // The API limits each *file* to MEDIA_MAX_UPLOAD_MB and each request to
  // MAX_FILES_PER_REQUEST. This screen used to block on the *total* size of
  // the batch instead, a rule the API never had — so fifteen ordinary
  // photographs, none of them oversized, were refused for exceeding a limit
  // that did not exist. Worse, the message named megabytes while the admin was
  // counting files, so the ceiling looked like a count.
  maxFileMb = 100;      // Must match the API's MEDIA_MAX_UPLOAD_MB
  maxFiles = 50;        // Must match the API's MAX_FILES_PER_REQUEST
  maxFileBytes = this.maxFileMb * 1024 * 1024;

  totalUploadSize = computed(() =>
    this.selectedFiles().reduce((sum, f) => sum + f.size, 0)
  );

  /** The files the API will reject, named individually so they can be removed. */
  oversizedFiles = computed(() =>
    this.selectedFiles().filter(f => f.size > this.maxFileBytes)
  );

  tooManyFiles = computed(() => this.selectedFiles().length > this.maxFiles);

  /** Blocks the upload — each of these is a rule the API actually enforces. */
  uploadSizeExceeded = computed(() =>
    this.oversizedFiles().length > 0 || this.tooManyFiles()
  );

  /**
   * A large batch is allowed but slow, and a request that times out mid-upload
   * looks like a failure rather than a wait. Advice, not a limit.
   */
  largeBatchWarning = computed(() => {
    const mb = this.totalUploadSize() / 1024 / 1024;
    return mb > 200 ? `${mb.toFixed(0)} MB in one go may be slow — consider two batches.` : null;
  });

  // UI state
  toastMsg = signal('');
  private toastTimer: any;

  // Inspection state
  inspectResults = signal<SuggestedMetadata[]>([]);
  isInspecting = signal(false);
  showMetadataGrid = signal(false);

  // Upload state
  isUploading = signal(false);
  uploadProgress = signal(0);
  uploadError = signal('');
  uploadResults = signal<UploadResult | null>(null);
  // Why the upload will not be visible yet. Held in state rather than only
  // toasted, because a toast disappears and the reason is what the admin needs
  // while deciding what to do next.
  catalogueWarnings = signal<string[]>([]);

  // Form state - shared across all files in batch
  make = signal('');
  model = signal('');
  modelYear = signal<number | null>(null);
  category = signal(''); // Body type: SUV, Sedan, etc.
  fuelType = signal('');
  transmission = signal('');
  imageCategory = signal(''); // exterior_front, interior_dashboard, etc.
  // ── Catalogue-driven identity pickers ────────────────────────────────────
  //
  // Make, model, variant and year were four free-text boxes, which is how the
  // catalogue ends up holding "Maruti" and "Maruti Suzuki" as different
  // manufacturers, and how a photograph misses the model it belongs to by a
  // stray space — an image matches its car on exactly these fields.
  //
  // Each is a dropdown of what the catalogue already holds, cascading so the
  // models offered belong to the chosen make. Each also keeps a way to type a
  // new value: a pure dropdown could never add a model the catalogue has not
  // seen, which is precisely what an admin photographing a new launch is doing.
  catalogue = signal<CatalogueOption[]>([]);

  makeOptions = computed(() =>
    [...new Set(this.catalogue().map(o => o.make))].sort()
  );
  modelOptions = computed(() =>
    [...new Set(
      this.catalogue().filter(o => o.make === this.make()).map(o => o.model)
    )].sort()
  );
  variantOptions = computed(() =>
    [...new Set(
      this.catalogue()
        .filter(o => o.make === this.make() && o.model === this.model())
        .map(o => o.variant)
        .filter((v): v is string => !!v)
    )].sort()
  );
  yearOptions = computed(() =>
    [...new Set(
      this.catalogue()
        .filter(o => o.make === this.make() && o.model === this.model())
        .map(o => o.year)
    )].sort((a, b) => b - a)
  );

  // Whether each field is being typed rather than chosen. Set when the admin
  // picks "Add new…", and forced on when the catalogue offers nothing to pick.
  customMake = signal(false);
  customModel = signal(false);
  customVariant = signal(false);
  customYear = signal(false);

  /** Sentinel option value meaning "let me type one". */
  readonly ADD_NEW = '__add_new__';

  /**
   * Handle a pick from one of the identity dropdowns.
   *
   * Choosing a make invalidates the model below it, and so on down: leaving a
   * Nexon selected under Maruti Suzuki would upload the photograph against a
   * vehicle that does not exist.
   */
  onIdentityPick(field: 'make' | 'model' | 'variant' | 'year', value: string) {
    const custom = value === this.ADD_NEW;

    if (field === 'make') {
      this.customMake.set(custom);
      this.make.set(custom ? '' : value);
      this.model.set(''); this.customModel.set(false);
      this.variant.set(''); this.customVariant.set(false);
      this.modelYear.set(null); this.customYear.set(false);
    } else if (field === 'model') {
      this.customModel.set(custom);
      this.model.set(custom ? '' : value);
      this.variant.set(''); this.customVariant.set(false);
      this.modelYear.set(null); this.customYear.set(false);
    } else if (field === 'variant') {
      this.customVariant.set(custom);
      this.variant.set(custom ? '' : value);
    } else {
      this.customYear.set(custom);
      this.modelYear.set(custom ? null : Number(value));
    }
  }

  /**
   * Why the identity fields are text boxes rather than dropdowns, when they
   * are.
   *
   * Falling back silently is indistinguishable from the feature never having
   * shipped, and the two causes call for different actions: an empty catalogue
   * is normal and the admin should simply type the first entry, while an
   * unreachable one means the API is down or behind and the catalogue this
   * upload creates may not be the one they expect.
   */
  catalogueStatus = signal<'ok' | 'empty' | 'unavailable'>('ok');

  /** Load the identities the catalogue already knows, for the dropdowns. */
  private async loadCatalogueOptions() {
    try {
      const resp = await fetch(`${this.apiUrl}/cars/catalogue/options`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const items = (await resp.json()).items ?? [];
      this.catalogue.set(items);
      this.catalogueStatus.set(items.length ? 'ok' : 'empty');
    } catch (err) {
      // A catalogue that cannot be listed must not block an upload — the
      // fields simply fall back to being typed, which is what they were.
      console.error('Catalogue options unavailable, falling back to free text:', err);
      this.catalogue.set([]);
      this.catalogueStatus.set('unavailable');
      this.customMake.set(true);
      this.customModel.set(true);
      this.customYear.set(true);
    }
  }

  // Which catalogue surface this image serves: 'new', 'used' or 'both'.
  // Starts empty and is mandatory, so the admin makes the choice deliberately
  // rather than inheriting the API's "both" default without noticing.
  mediaBucket = signal('');
  // The manufacturer's ex-showroom price for this model. The New Cars pages
  // only show priced models — a grid that sorts and filters on price cannot
  // render one without it — so an upload aimed at New Cars that leaves this
  // blank produces a photograph nobody will ever see. There is no on-road
  // field: on-road is derived from this figure and varies by state and by what
  // the buyer chooses, so it cannot be one stored number per model.
  exShowroomPrice = signal<number | null>(null);
  /**
   * Whether this vehicle is already in the catalogue.
   *
   * Matched on make, model and year — not variant, because photographs belong
   * to a model rather than a trim and the catalogue lookup ignores variant for
   * the same reason.
   */
  modelIsKnown = computed(() => {
    const year = this.modelYear();
    if (!this.make() || !this.model() || !year) return false;
    return this.catalogue().some(
      o => o.make === this.make() && o.model === this.model() && o.year === year
    );
  });

  /**
   * Ask for a price only when this upload would introduce a model the
   * catalogue has never held.
   *
   * A price belongs to a vehicle, not to a photograph, and the pricing screen
   * is where one is set and revised. Asking on every upload put a money field
   * in front of an admin doing something else entirely, fifteen times over for
   * fifteen pictures of one car — and implied the price was a property of the
   * images. It is still asked for a genuinely new model, because that is the
   * moment the alternative is a catalogue entry no page will show.
   */
  needsPrice = computed(() =>
    ['new', 'both'].includes(this.mediaBucket()) && !this.modelIsKnown()
  );
  variant = signal('');
  colour = signal('');
  source = signal('');
  copyright = signal('');
  license = signal('');

  ngOnInit() {
    // Verify admin is logged in
    if (!this.auth.isAdmin()) {
      this.toast('Admin access required');
    }
    this.loadCatalogueOptions();
  }

  @HostListener('dragover', ['$event']) onDragOver(e: DragEvent) {
    e.preventDefault();
    this.dragOver.set(true);
  }
  @HostListener('dragleave') onDragLeave() {
    this.dragOver.set(false);
  }
  @HostListener('drop', ['$event']) onDrop(e: DragEvent) {
    e.preventDefault();
    this.dragOver.set(false);
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (files.length) this.handleFiles(files);
  }

  onFileSelect(e: Event) {
    const input = e.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    if (files.length) this.handleFiles(files);
    input.value = '';
  }

  private handleFiles(files: File[]) {
    // Filter for images only
    const imageFiles = files.filter(f => f.type.startsWith('image/'));
    if (imageFiles.length === 0) {
      this.toast('❌ No image files selected. Please choose JPEG, PNG, WebP, HEIC, or TIFF.');
      return;
    }
    if (imageFiles.length < files.length) {
      this.toast(`⚠ ${files.length - imageFiles.length} non-image file(s) excluded`);
    }
    this.selectedFiles.set(imageFiles);
    // Don't show grid yet - let user click "Inspect" first
  }

  async inspectFiles() {
    const files = this.selectedFiles();
    if (!files.length) {
      this.toast('❌ No files selected');
      return;
    }

    this.isInspecting.set(true);
    const formData = new FormData();
    files.forEach(f => formData.append('files', f));

    try {
      const token = await this.getToken();
      const headers: Record<string, string> = {};
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      console.log('Fetching /media-admin/inspect with headers:', Object.keys(headers));
      const response = await fetch(`${this.apiUrl}/media-admin/inspect`, {
        method: 'POST',
        body: formData,
        headers,
      });

      console.log('Response status:', response.status, 'Content-Type:', response.headers.get('content-type'));

      if (!response.ok) {
        const errorText = await response.text();
        console.error('API error response:', errorText);
        throw new Error(`API error ${response.status}: ${errorText}`);
      }

      const results = await response.json();
      this.inspectResults.set(results);
      this.showMetadataGrid.set(true);
      this.toast(`✓ Inspected ${results.length} file(s) — edit metadata below`);
    } catch (err) {
      console.error('Inspect error details:', err);
      if (err instanceof Error) {
        console.error('Stack trace:', err.stack);
      }
      this.toast(`❌ Inspection failed: ${err}`);
    } finally {
      this.isInspecting.set(false);
    }
  }

  async uploadImages() {
    const files = this.selectedFiles();
    if (!files.length) {
      this.toast('❌ No files to upload');
      return;
    }

    // Validate mandatory fields
    if (!this.make() || !this.model() || !this.modelYear() || !this.category() ||
        !this.fuelType() || !this.transmission() || !this.imageCategory() ||
        !this.mediaBucket()) {
      this.toast('❌ Please fill all mandatory fields: Make, Model, Year, Body Type, Fuel, Transmission, Image Category, Show On');
      return;
    }

    // Caught here rather than left to the server: an upload aimed at New Cars
    // without a price succeeds and then shows up nowhere, which reads as the
    // upload having failed silently.
    if (this.needsPrice() && !this.exShowroomPrice()) {
      this.toast('❌ Ex-showroom price is required for a New Cars upload — those pages only show priced models');
      return;
    }

    this.isUploading.set(true);
    this.uploadError.set('');

    const formData = new FormData();
    files.forEach(f => formData.append('files', f));

    // Add metadata
    formData.append('make', this.make());
    formData.append('model', this.model());
    formData.append('model_year', String(this.modelYear()));
    formData.append('category', this.category());
    formData.append('fuel_type', this.fuelType());
    formData.append('transmission', this.transmission());
    formData.append('image_category', this.imageCategory());
    formData.append('media_bucket', this.mediaBucket());
    const price = this.exShowroomPrice();
    if (price != null) formData.append('ex_showroom_price', String(price));
    if (this.variant()) formData.append('variant', this.variant());
    if (this.colour()) formData.append('colour', this.colour());
    if (this.source()) formData.append('source', this.source());
    if (this.copyright()) formData.append('copyright', this.copyright());
    if (this.license()) formData.append('license', this.license());

    try {
      const token = await this.getToken();
      const headers: Record<string, string> = {};
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const response = await fetch(`${this.apiUrl}/media-admin/upload`, {
        method: 'POST',
        body: formData,
        headers,
      });

      if (!response.ok) {
        throw new Error(await this.describeError(response));
      }

      const result = await response.json();
      this.uploadResults.set(result);

      if (result.stored > 0) {
        this.toast(`✅ ${result.stored} image(s) uploaded, ${result.deduplicated} duplicate(s) linked`);
        this.resetForm();
      } else if (result.deduplicated > 0) {
        this.toast(`ℹ All ${result.deduplicated} image(s) already in library (deduped)`);
        this.resetForm();
      }

      // A stored image that no page can show is the failure this screen used to
      // hide, so say it out loud rather than reporting an unqualified success.
      // Kept on screen rather than only toasted: these explain why a
      // photograph is not where the admin is about to go looking for it, which
      // is worth reading after the toast has gone.
      const warnings: string[] = result.catalogue_warnings ?? [];
      this.catalogueWarnings.set(warnings);
      if (warnings.length) {
        this.toast(`⚠️ ${warnings[0]}`);
      }

      if (result.errors.length > 0) {
        this.uploadError.set(`Errors: ${result.errors.join('; ')}`);
      }
    } catch (err) {
      this.uploadError.set(String(err));
      this.toast(`❌ Upload failed: ${err}`);
    } finally {
      this.isUploading.set(false);
    }
  }

  cancelUpload() {
    this.resetForm();
    this.toast('Upload cancelled');
  }

  private resetForm() {
    this.selectedFiles.set([]);
    this.inspectResults.set([]);
    this.showMetadataGrid.set(false);
    this.uploadResults.set(null);
    this.uploadError.set('');
    this.make.set('');
    this.model.set('');
    this.modelYear.set(null);
    this.category.set('');
    this.fuelType.set('');
    this.transmission.set('');
    this.imageCategory.set('');
    this.mediaBucket.set('');
    this.exShowroomPrice.set(null);
    this.variant.set('');
    this.colour.set('');
    this.source.set('');
    this.copyright.set('');
    this.license.set('');
  }

  /**
   * Turn an error response into something a human can act on.
   *
   * `detail` arrives in three different shapes from this API:
   *   string — plain HTTPException, e.g. an unknown image category
   *   array  — FastAPI request validation, one entry per bad field
   *   object — this router's "No image could be stored", where the real
   *            per-file reasons live in detail.errors
   *
   * The previous code did `new Error(error.detail)` for all three, so both
   * non-string shapes rendered as "[object Object]" — including the one that
   * carries the actual storage failure.
   */
  private async describeError(response: Response): Promise<string> {
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return `Upload failed: ${response.status} ${response.statusText}`;
    }

    const detail = (body as { detail?: unknown })?.detail;

    if (typeof detail === 'string') return detail;

    if (Array.isArray(detail)) {
      // loc is like ["body", "model_year"]; the last element is the field name.
      const parts = detail.map((d: { loc?: unknown[]; msg?: string }) => {
        const field = Array.isArray(d.loc) ? String(d.loc[d.loc.length - 1]) : 'field';
        return `${field}: ${d.msg ?? 'invalid'}`;
      });
      return `Please check these fields — ${parts.join('; ')}`;
    }

    if (detail && typeof detail === 'object') {
      const d = detail as { message?: string; errors?: unknown[] };
      const reasons = Array.isArray(d.errors) ? d.errors.map(String) : [];
      return reasons.length
        ? `${d.message ?? 'Upload failed'} ${reasons.join(' | ')}`
        : (d.message ?? JSON.stringify(detail));
    }

    return `Upload failed: ${response.status} ${response.statusText}`;
  }

  /**
   * Supabase access token for the signed-in user, or '' when there is none.
   *
   * Reads the injected SupabaseService — the same client authInterceptor uses.
   * This previously read a `window.supabaseClient` global that nothing ever
   * assigns, so it always returned '', the Authorization header was silently
   * omitted, and every upload came back "401 Not authenticated" while the UI
   * showed the user as signed in.
   *
   * The uploads on this page use fetch() rather than HttpClient so that
   * FormData streams without Angular re-encoding it, which means
   * authInterceptor never sees them and the header has to be attached by hand.
   */
  private async getToken(): Promise<string> {
    try {
      const { data } = await this.supabase.client.auth.getSession();
      return data.session?.access_token ?? '';
    } catch (err) {
      console.warn('Failed to get Supabase token:', err);
      return '';
    }
  }

  private toast(msg: string) {
    this.toastMsg.set(msg);
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toastMsg.set(''), 4000);
  }

  // Helpers for template
  imageCategoryOptions = [
    'exterior_front', 'exterior_rear', 'exterior_left', 'exterior_right',
    'front_quarter', 'rear_quarter', 'interior_dashboard', 'steering',
    'infotainment', 'seats', 'boot_space', 'engine_bay', 'wheels',
    'sunroof', 'safety', 'accessories', 'gallery', 'three_sixty',
  ];

  fuelOptions = ['Petrol', 'Diesel', 'CNG', 'Hybrid', 'Electric'];
  transmissionOptions = ['Manual', 'Automatic', 'CVT'];
  bodyTypeOptions = ['SUV', 'Sedan', 'Hatchback', 'Coupe', 'Convertible', 'MUV', 'Pickup', 'Wagon'];

  formatCategoryName(category: string): string {
    return category.replace(/_/g, ' ');
  }

  updateInspectResult(index: number, field: string, value: any) {
    const results = this.inspectResults();
    results[index] = { ...results[index], [field]: value };
    this.inspectResults.set([...results]);
  }

  startOver() {
    this.resetForm();
  }
}

/** One vehicle identity the catalogue already holds. */
interface CatalogueOption {
  make: string;
  model: string;
  variant: string | null;
  year: number;
}

interface SuggestedMetadata {
  filename: string;
  make?: string;
  model?: string;
  variant?: string;
  model_year?: number;
  image_category?: string;
  colour?: string;
}

interface UploadResult {
  catalogue_car_id?: string | null;
  catalogue_car_created?: boolean;
  catalogue_warnings?: string[];
  stored: number;
  deduplicated: number;
  rejected: number;
  images: any[];
  errors: string[];
}
