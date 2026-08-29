import {
  Component, signal, computed, inject, OnInit,
  ChangeDetectionStrategy, HostListener,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { IconComponent } from '../../components/icon/icon.component';
import { AuthService } from '../../services/auth.service';
import { SupabaseService } from '../../services/supabase.service';
import { environment } from '../../../environments/environment';
import { CustomSelectComponent, SelectOption } from '../../components/custom-select/custom-select.component';
import { TranslatePipe } from '../../pipes/translate.pipe';

@Component({
  selector: 'app-admin-car-images',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, IconComponent, CustomSelectComponent, TranslatePipe],
  templateUrl: './admin-car-images.component.html',
  styleUrls: ['./admin-car-images.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminCarImagesComponent implements OnInit {

  /** Which catalogue pages an image appears on. Values are what the API takes. */
  readonly mediaBucketOptions: SelectOption[] = [
    { value: 'new', label: 'New Cars only' },
    { value: 'used', label: 'Used Cars only' },
    { value: 'both', label: 'Both New & Used' },
  ];

  /**
   * Image categories with their display names. The stored value stays the raw
   * key the API expects; formatCategoryName only ever changes how it reads.
   */
  imageCategorySelectOptions(): SelectOption[] {
    return this.imageCategoryOptions.map(opt => ({
      value: opt,
      label: this.formatCategoryName(opt),
    }));
  }
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

  // ---- Step 3: review the model's trim prices -------------------------------
  //
  // The upload establishes which vehicle the photographs are of. That is the
  // moment the catalogue knows a model is in play, and the moment an admin is
  // already thinking about it — so it is where the trim prices get checked,
  // rather than on a screen they have to remember to visit afterwards.
  //
  // Nothing here reaches a buyer unreviewed. Researched trims are created as
  // drafts and New Cars renders published ones only, so the figures on this
  // step are invisible until the admin publishes them. That is what makes it
  // safe to ask a language model for a price at all: it will state a wrong one
  // with complete confidence, and a person sees it first.
  pricingCarId = signal<string>('');
  pricingVehicle = signal<string>('');
  pricingTrims = signal<TrimRow[]>([]);
  researchingPrices = signal(false);
  pricingError = signal('');
  savingTrim = signal<string>('');
  /**
   * In the step. Not keyed on the car id any more — a vehicle the catalogue
   * has no row for still gets a panel, holding drafts that are created once
   * the upload makes the row.
   */
  inPricingStep = signal(false);
  /**
   * Offer the pricing step for every New Cars upload.
   *
   * THIS USED TO REQUIRE modelIsKnown(), AND THAT WAS THE BUG.
   *
   * modelIsKnown() matches make + model + *year* against the catalogue, while
   * the year picker deliberately offers this year and next whether or not the
   * catalogue has reached them — it exists so a new launch can be photographed
   * before it is listed. So Grand Vitara 2026, on a catalogue holding 2024 and
   * 2025, failed the check and fell straight through to Upload with no pricing
   * step at all.
   *
   * That skipped exactly the case researched prices are most wanted for, and
   * it was indistinguishable on screen from the feature not being deployed.
   *
   * Research does not actually need a catalogue row — variant_research works
   * from make, model and year. Only *persisting* the result needs one, and
   * that can wait until the upload has created it.
   */
  canPriceBeforeUpload = computed(() =>
    ['new', 'both'].includes(this.mediaBucket())
    && !!this.make() && !!this.model() && !!this.modelYear()
  );
  /** True once the admin has been through (or skipped) the pricing step. */
  pricingReviewed = signal(false);
  /** Trims whose price the admin has changed and not yet saved. */
  unsavedTrims = computed(() => this.pricingTrims().filter(t => t.dirty).length);

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
  /**
   * The current model year, and the one manufacturers are already selling into.
   *
   * Indian OEMs list next year's model well before January, so a photograph
   * taken today may legitimately belong to either.
   */
  private currentModelYears(): number[] {
    const now = new Date().getFullYear();
    return [now + 1, now];
  }

  /**
   * Years to offer, newest first.
   *
   * The catalogue's own years alone were wrong for the case this screen exists
   * for: photographing a new launch. A model whose catalogue rows are 2020-2023
   * offered only those, so a picture of the current car was filed under an
   * older year and never appeared on the New Cars page — the images match a car
   * on make, model *and* year. The current years are always available, whether
   * or not the catalogue has caught up.
   */
  yearOptions = computed(() => {
    const catalogueYears = this.catalogue()
      .filter(o => o.make === this.make() && o.model === this.model())
      .map(o => o.year);
    return [...new Set([...this.currentModelYears(), ...catalogueYears])]
      .sort((a, b) => b - a);
  });

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
      this.customYear.set(false);
      // Default to the current model year rather than leaving the field empty.
      // An admin uploading photographs is nearly always shooting the car on
      // sale now, and an empty box invited picking whichever old year happened
      // to sit at the top of the list.
      this.modelYear.set(custom ? null : this.currentModelYears()[1]);
    } else if (field === 'variant') {
      this.customVariant.set(custom);
      this.variant.set(custom ? '' : value);
    } else {
      this.customYear.set(custom);
      // The placeholder row sends '', which Number() would turn into the year
      // 0 — a silent wrong answer rather than an empty field.
      this.modelYear.set(custom || !value ? null : Number(value));
    }
  }

  /**
   * The two year pickers, as {value,label} for app-custom-select.
   *
   * These were the last native <select> elements in the app, and the last
   * dropdowns whose popup the operating system drew in its own colours. They
   * were left alone because they bound [ngValue] with numbers and null while
   * the dropdown component stores text; the conversion is done here, at the
   * boundary, so the signals below still hold `number | null` exactly as the
   * upload and the image query expect.
   *
   * '' is the empty choice in both, and maps back to null.
   */
  manageYearSelectOptions = computed(() => [
    { value: '', label: 'All years' },
    ...this.manageYearOptions().map(y => ({ value: String(y), label: String(y) })),
  ]);

  modelYearSelectOptions = computed(() => [
    { value: '', label: 'Select year…' },
    ...this.yearOptions().map(y => ({ value: String(y), label: String(y) })),
    { value: this.ADD_NEW, label: '➕ Add new year…' },
  ]);

  /** Signal value as the text the dropdown holds. */
  yearAsText(year: number | null): string {
    return year === null ? '' : String(year);
  }

  onManageYear(value: string) {
    this.manageYear.set(value ? Number(value) : null);
    void this.loadExistingImages();
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
  private matchingCatalogueEntries = computed(() => {
    const year = this.modelYear();
    if (!this.make() || !this.model() || !year) return [];
    return this.catalogue().filter(
      o => o.make === this.make() && o.model === this.model() && o.year === year
    );
  });

  modelIsKnown = computed(() => this.matchingCatalogueEntries().length > 0);

  /**
   * Whether this model already carries a price.
   *
   * Not the same question as whether the catalogue knows it. New Cars renders
   * only priced models, so an entry with a null price is one no buyer will
   * ever see — and an upload against it succeeds, returns 201, and disappears.
   */
  modelHasPrice = computed(() =>
    this.matchingCatalogueEntries().some(o => o.ex_showroom_price != null)
  );

  /**
   * Ask for a price when this upload would otherwise land on a model that no
   * New Cars page will show.
   *
   * A price belongs to a vehicle, not to a photograph, and the pricing screen
   * is where one is set and revised. Asking on every upload put a money field
   * in front of an admin doing something else entirely, fifteen times over for
   * fifteen pictures of one car. But "the catalogue knows this model" was the
   * wrong test for skipping it: a model can be known and unpriced, and then
   * the upload is stored against a row New Cars filters out — success by every
   * signal the screen gives, and invisible.
   */
  needsPrice = computed(() =>
    ['new', 'both'].includes(this.mediaBucket()) && !this.modelHasPrice()
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

  /**
   * Browsers do not always know what a HEIC or TIFF is.
   *
   * The file picker offers them — `accept` lists both — but Chrome reports an
   * empty `type` for a .heic on most platforms, so filtering on `type` alone
   * threw away exactly the files the picker had just invited. Fall back to the
   * extension when the browser has no opinion.
   */
  private readonly imageExtensions = /\.(jpe?g|png|webp|gif|bmp|heic|heif|tiff?|avif)$/i;

  private isImage(file: File): boolean {
    return file.type
      ? file.type.startsWith('image/')
      : this.imageExtensions.test(file.name);
  }

  private handleFiles(files: File[]) {
    const imageFiles = files.filter(f => this.isImage(f));
    if (imageFiles.length === 0) {
      this.toast('❌ No image files selected. Please choose JPEG, PNG, WebP, HEIC, or TIFF.');
      return;
    }
    if (imageFiles.length < files.length) {
      this.toast(`⚠ ${files.length - imageFiles.length} non-image file(s) excluded`);
    }

    // Add to the selection rather than replace it. Fifteen photographs of one
    // car rarely arrive in a single gesture — some are dragged, some picked,
    // some remembered afterwards — and replacing silently discarded whatever
    // had been gathered so far. Identity is name plus size: the same file
    // offered twice is the same file, not two.
    const existing = this.selectedFiles();
    const seen = new Set(existing.map(f => `${f.name}:${f.size}`));
    const added = imageFiles.filter(f => !seen.has(`${f.name}:${f.size}`));
    const duplicates = imageFiles.length - added.length;
    if (duplicates) {
      this.toast(`⚠ ${duplicates} file(s) already selected`);
    }
    this.selectedFiles.set([...existing, ...added]);
    // Don't show grid yet - let user click "Inspect" first
  }

  removeFile(file: File) {
    this.selectedFiles.set(this.selectedFiles().filter(f => f !== file));
  }

  clearFiles() {
    this.selectedFiles.set([]);
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

    // Captured before the upload, because a successful one resets the form and
    // step 3 still needs to know which vehicle it is pricing.
    const bucket = this.mediaBucket();
    const vehicleLabel = `${this.make()} ${this.model()} ${this.modelYear()}`;
    // Whether the trims were already reviewed on the metadata screen. If they
    // were, re-running research after the upload would reopen a panel the
    // admin has just finished with.
    const pricedBefore = this.inPricingStep() || this.pricingReviewed();
    // Captured before resetForm clears the panel. These were researched for a
    // vehicle with no catalogue row, so they have nowhere to live until this
    // upload creates one.
    const pendingTrims = this.pricingTrims().filter(t => t.pending);

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

      // The pricing step normally runs *before* this, from the metadata
      // screen. It runs here only for the case that could not: a model the
      // catalogue had never seen, whose row this upload has just created.
      //
      // Read the vehicle from the result rather than the form — the reset
      // above has already cleared the form fields.
      if (result.catalogue_car_id && ['new', 'both'].includes(bucket)) {
        if (pendingTrims.length) {
          // Trims the admin priced before the upload, for a vehicle that had
          // no catalogue row to hold them. The row exists now.
          await this.createPendingTrims(result.catalogue_car_id, pendingTrims);
        } else if (!pricedBefore) {
          await this.startPricingStep(result.catalogue_car_id, vehicleLabel);
        }
      }
    } catch (err) {
      this.uploadError.set(String(err));
      this.toast(`❌ Upload failed: ${err}`);
    } finally {
      this.isUploading.set(false);
    }
  }

  /**
   * Step 3 — ask the model for this vehicle's trims, then let the admin price
   * them.
   *
   * Runs after the images are stored, not before, for a plain reason: the
   * research endpoint drafts trims against a catalogue row, and until the
   * upload has run there may be no row to draft against. Uploading first also
   * means a failure here costs the admin nothing — the photographs are already
   * safe, and this step can be skipped or retried.
   *
   * Only for New Cars uploads. Used Cars is built from adverts, and a
   * catalogue model has no asking price, so trim pricing has nothing to say
   * there.
   */
  /**
   * Enter the pricing step from the metadata screen, before the images are
   * committed — which is where it was asked for and where it belongs: the
   * admin decides the figures, then uploads.
   *
   * Resolving the row first matters more than it looks. Research is addressed
   * by car id, and the id has to be the one the upload will attach to; the
   * endpoint answering that mirrors the upload's own matching, with a test
   * pinning the two together.
   */
  async reviewPricesBeforeUpload() {
    const make = this.make(), model = this.model(), year = this.modelYear();
    if (!make || !model || !year) {
      this.toast('❌ Choose make, model and year first');
      return;
    }
    this.researchingPrices.set(true);
    this.pricingError.set('');
    try {
      const params = new URLSearchParams({ make, model, year: String(year) });
      const resp = await fetch(`${this.apiUrl}/cars/catalogue/resolve?${params}`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const carId: string | null = (await resp.json()).car_id;
      this.pricingVehicle.set(`${make} ${model} ${year}`);

      if (carId) {
        // The catalogue has this vehicle: research against the row, so drafts
        // are stored and existing trims are shown alongside them.
        await this.startPricingStep(carId, `${make} ${model} ${year}`);
      } else {
        // No row yet. Research by identity and hold the result in memory —
        // these are created after the upload has made a row to hang them on.
        const params2 = new URLSearchParams({ make, model, year: String(year) });
        const r = await fetch(
          `${this.apiUrl}/cars/catalogue/research-trims?${params2}`,
          { method: 'POST', headers: await this.authHeaders() },
        );
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const drafts: any[] = await r.json();
        this.pricingCarId.set('');
        this.pricingTrims.set(drafts.map((d, i) => ({
          id: `pending-${i}`,
          name: d.name,
          price: d.ex_showroom_price == null ? null : Number(d.ex_showroom_price),
          status: 'draft',
          source: 'ai',
          dirty: false,
          pending: true,
        })));
        this.inPricingStep.set(true);
      }
      this.pricingReviewed.set(true);
    } catch (err) {
      this.pricingError.set(`Could not load trims: ${err}`);
      // Never trap the admin on this step: the images are the job, and a
      // pricing lookup failing must not stop them being uploaded.
      this.pricingReviewed.set(true);
    } finally {
      this.researchingPrices.set(false);
    }
  }

  private async startPricingStep(carId: string, vehicle: string) {
    this.pricingCarId.set(carId);
    this.pricingVehicle.set(vehicle);
    this.inPricingStep.set(true);
    this.pricingTrims.set([]);
    this.pricingError.set('');
    this.researchingPrices.set(true);
    try {
      // Fills gaps only: a trim already recorded is left exactly as it is, so
      // this never overwrites a price an admin has already vouched for.
      const resp = await fetch(`${this.apiUrl}/cars/${carId}/variants/research`, {
        method: 'POST',
        headers: await this.authHeaders(),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      await this.loadPricingTrims();
    } catch (err) {
      this.pricingError.set(
        `Could not draft trims automatically (${err}). You can still price ` +
        `this model under Variants.`
      );
      // Show whatever is already recorded rather than an empty panel — the
      // research failing does not mean there is nothing to review.
      await this.loadPricingTrims().catch(() => {});
    } finally {
      this.researchingPrices.set(false);
    }
  }

  /**
   * Write the pre-upload drafts to the row this upload just created.
   *
   * As drafts, with the admin's prices. Draft rather than published because
   * publishing is a separate act of vouching, and pressing Upload is not that
   * — it says "these photographs are right", not "these prices are correct to
   * show a buyer". They are one click away under Variants.
   *
   * Failures are reported, never silent: the admin priced these deliberately,
   * and losing them without a word is worse than the step not existing.
   */
  private async createPendingTrims(carId: string, rows: TrimRow[]) {
    const failed: string[] = [];
    for (const [index, row] of rows.entries()) {
      try {
        const resp = await fetch(`${this.apiUrl}/cars/${carId}/variants`, {
          method: 'POST',
          headers: { ...(await this.authHeaders()), 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: row.name,
            ex_showroom_price: row.price == null ? null : String(row.price),
            sort_order: index,
          }),
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      } catch {
        failed.push(row.name);
      }
    }

    this.pricingCarId.set(carId);
    this.inPricingStep.set(true);
    await this.loadPricingTrims().catch(() => {});

    if (failed.length) {
      this.pricingError.set(
        `These trims could not be saved: ${failed.join(', ')}. Add them under Variants.`
      );
    } else {
      this.toast(`✅ ${rows.length} trim(s) saved as drafts — publish when you are ready`);
    }
  }

  private async loadPricingTrims() {
    const carId = this.pricingCarId();
    if (!carId) return;
    const resp = await fetch(`${this.apiUrl}/cars/${carId}/variants`, {
      headers: await this.authHeaders(),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const variants: any[] = await resp.json();
    this.pricingTrims.set(variants.map(v => ({
      id: v.id,
      name: v.name,
      price: v.ex_showroom_price == null ? null : Number(v.ex_showroom_price),
      status: v.status,
      source: v.source,
      dirty: false,
    })));
  }

  /**
   * A method, not a computed over the row object.
   *
   * These rows are bound with ngModel, and a computed() tracks signal reads
   * only — over a plain field it evaluates once and then reports a stale
   * answer forever. That has shipped here twice.
   */
  setTrimPrice(id: string, value: unknown) {
    const parsed = value === '' || value === null || value === undefined
      ? null
      : Number(value);
    this.pricingTrims.update(rows => rows.map(r =>
      r.id === id
        ? { ...r, price: Number.isFinite(parsed as number) ? parsed : null, dirty: true }
        : r
    ));
  }

  /** Save a corrected price without publishing it. */
  async saveTrim(row: TrimRow) {
    await this.patchTrim(row, { ex_showroom_price: row.price == null ? null : String(row.price) });
  }

  /**
   * Publish is the act of vouching for the figure, so it saves the price the
   * admin is looking at in the same request. Publishing a row while an edited
   * price sat unsaved would put the *researched* number in front of buyers —
   * exactly the outcome this step exists to prevent.
   */
  async publishTrim(row: TrimRow) {
    if (row.price == null) {
      this.pricingError.set(`${row.name} has no price. Give it one before publishing.`);
      return;
    }
    await this.patchTrim(row, {
      ex_showroom_price: String(row.price),
      status: 'published',
    });
  }

  private async patchTrim(row: TrimRow, body: Record<string, unknown>) {
    const carId = this.pricingCarId();
    if (!carId) return;
    this.savingTrim.set(row.id);
    this.pricingError.set('');
    try {
      const resp = await fetch(`${this.apiUrl}/cars/${carId}/variants/${row.id}`, {
        method: 'PATCH',
        headers: { ...(await this.authHeaders()), 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const updated = await resp.json();
      this.pricingTrims.update(rows => rows.map(r => r.id === row.id ? {
        ...r,
        price: updated.ex_showroom_price == null ? null : Number(updated.ex_showroom_price),
        status: updated.status,
        dirty: false,
      } : r));
      this.toast(`✅ ${row.name} saved`);
    } catch (err) {
      this.pricingError.set(`Could not save ${row.name}: ${err}`);
    } finally {
      this.savingTrim.set('');
    }
  }

  finishPricing() {
    this.inPricingStep.set(false);
    this.pricingCarId.set('');
    this.pricingVehicle.set('');
    this.pricingTrims.set([]);
    this.pricingError.set('');
    this.pricingReviewed.set(true);
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
    // Not the pricing panel itself — that is deliberately left on screen after
    // an upload so the admin can finish publishing trims. Only the flag that
    // decides whether the *next* batch gets offered the step.
    this.pricingReviewed.set(false);
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
  // ── Existing images: what is actually on the site for this vehicle ────────
  //
  // An image uploaded against the wrong car is a mistake a buyer can see, and
  // the only way to correct one was to change its metadata — which moves it to
  // another car rather than taking it off the site. A bad shot had no exit at
  // all.
  existingImages = signal<VehicleImage[]>([]);
  existingLoading = signal(false);
  existingError = signal('');
  removingId = signal<string | null>(null);
  /** The last removal, so it can be undone without hunting for it. */
  lastRemoved = signal<VehicleImage | null>(null);

  // Its own vehicle picker, independent of the upload form's.
  //
  // Removing a wrong photograph is not a step in uploading one — this section
  // first lived inside the metadata step, which meant an admin had to start an
  // upload they did not want in order to delete something. It also must not
  // borrow the upload form's make and model, or choosing what to inspect would
  // quietly rewrite what is about to be uploaded.
  manageMake = signal('');
  manageModel = signal('');
  manageYear = signal<number | null>(null);

  manageModelOptions = computed(() =>
    [...new Set(
      this.catalogue().filter(o => o.make === this.manageMake()).map(o => o.model)
    )].sort()
  );
  manageYearOptions = computed(() =>
    [...new Set(
      this.catalogue()
        .filter(o => o.make === this.manageMake() && o.model === this.manageModel())
        .map(o => o.year)
    )].sort((a, b) => b - a)
  );

  onManageMake(make: string) {
    this.manageMake.set(make);
    this.manageModel.set('');
    this.manageYear.set(null);
    this.existingImages.set([]);
  }

  onManageModel(model: string) {
    this.manageModel.set(model);
    this.manageYear.set(null);
    // The model is the whole identity a photograph is matched on, so this is
    // enough to show what is on the site — no second click needed.
    void this.loadExistingImages();
  }

  /** Whether the identity is complete enough to ask what is on the site. */
  canListExisting = computed(() => !!this.manageMake() && !!this.manageModel());

  async loadExistingImages() {
    if (!this.canListExisting()) return;
    this.existingLoading.set(true);
    this.existingError.set('');
    try {
      const params = new URLSearchParams({
        make: this.manageMake(), model: this.manageModel(),
      });
      const year = this.manageYear();
      if (year) params.set('model_year', String(year));

      const resp = await fetch(
        `${this.apiUrl}/media-admin/vehicle-images?${params}`,
        { headers: await this.authHeaders() },
      );
      if (!resp.ok) throw new Error(await this.describeError(resp));
      this.existingImages.set(await resp.json());
    } catch (err) {
      this.existingError.set(String(err));
      this.existingImages.set([]);
    } finally {
      this.existingLoading.set(false);
    }
  }

  async removeImage(image: VehicleImage) {
    // Removal is undoable and the confirmation says so, which is what keeps it
    // a question rather than a warning.
    const fromListing = image.origin === 'listing';
    const ok = confirm(
      `Remove "${image.filename}" from the site?\n\n` +
      (fromListing
        // Say what actually happens to it, and where it goes. A dealer's
        // photograph is rejected rather than deleted, so "you can put it
        // back" is true — but only if the admin knows where.
        ? 'It stops appearing for buyers immediately. It moves to the '
          + 'Rejected tab of the review queue, where approving it puts it back.'
        : 'It stops appearing for buyers immediately. You can put it back.')
    );
    if (!ok) return;

    this.removingId.set(image.id);
    try {
      // Two tables, two endpoints. A listing photograph is keyed by an
      // integer in car_images and removed by rejecting it; a media-library
      // one is a UUID in vehicle_media and is marked deleted.
      const path = fromListing
        ? `${this.apiUrl}/media-admin/listing-image/${image.id}`
        : `${this.apiUrl}/media-admin/${image.id}`;
      const resp = await fetch(path, {
        method: 'DELETE',
        headers: await this.authHeaders(),
      });
      if (!resp.ok) throw new Error(await this.describeError(resp));
      this.existingImages.set(this.existingImages().filter(i => i.id !== image.id));
      this.lastRemoved.set(image);
      this.toast('🗑 Image removed — it is off the site');
    } catch (err) {
      this.toast(`❌ Could not remove it: ${err}`);
    } finally {
      this.removingId.set(null);
    }
  }

  async undoRemove() {
    const image = this.lastRemoved();
    if (!image) return;
    try {
      const resp = await fetch(`${this.apiUrl}/media-admin/${image.id}/restore`, {
        method: 'POST',
        headers: await this.authHeaders(),
      });
      if (!resp.ok) throw new Error(await this.describeError(resp));
      this.lastRemoved.set(null);
      this.toast('↩ Image restored');
      await this.loadExistingImages();
    } catch (err) {
      this.toast(`❌ Could not restore it: ${err}`);
    }
  }

  /** Bearer header, or none when there is no session to speak of. */
  private async authHeaders(): Promise<Record<string, string>> {
    const token = await this.getToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

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

/** One photograph currently on the site for a vehicle. */
interface VehicleImage {
  id: string;
  filename: string;
  url: string;
  thumbnail_url: string | null;
  image_category: string | null;
  variant: string | null;
  colour: string | null;
  media_bucket: string | null;
  created_at: string;
  /**
   * Which table the photograph came from.
   *
   * Optional because an older API build does not send it. Absent is treated
   * as 'media_library', which is what every row was before listing images
   * were included here.
   */
  origin?: 'media_library' | 'listing';
  /** False for listing photographs: removal belongs in the review queue. */
  removable?: boolean;
  /** Where removal does belong, when it is not here. */
  manage_at?: string | null;
}

/** One vehicle identity the catalogue already holds. */
interface CatalogueOption {
  make: string;
  model: string;
  variant: string | null;
  year: number;
  /** Null when the catalogue holds this model but no price for it. */
  ex_showroom_price?: number | null;
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

/**
 * One trim on the pricing step.
 *
 * `price` is held as a plain number for the input to bind to, separate from
 * the string the API returns, and `dirty` records that the admin changed it —
 * so a save sends only what they actually touched rather than writing every
 * researched figure back as though a person had vouched for it.
 */
interface TrimRow {
  id: string;
  name: string;
  price: number | null;
  status: string;
  source: string;
  dirty: boolean;
  /**
   * Researched but not yet in the database, because the vehicle had no
   * catalogue row when the step ran. Created after the upload makes one.
   */
  pending?: boolean;
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
