import { environment } from '../../../environments/environment';
import { Component, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../services/auth.service';
import { MyListingsService } from '../../services/my-listings.service';
import { SupabaseService } from '../../services/supabase.service';
import { CityService } from '../../services/city.service';
import { IconComponent } from '../../components/icon/icon.component';
import { ImageUploadService, UploadedImage } from '../../services/image-upload.service';
import { NativeService, NativePhoto } from '../../services/native.service';
import { ValuationResult, computeHeuristicValuation } from '../../utils/valuation-engine';
import { CustomSelectComponent, SelectOption } from '../../components/custom-select/custom-select.component';

@Component({
  selector: 'app-list-car',
  standalone: true,
  imports: [RouterLink, CommonModule, FormsModule, IconComponent, CustomSelectComponent],
  templateUrl: './list-car.component.html',
  styleUrl: './list-car.component.scss'
})
export class ListCarComponent {

  /** The dropdown stores text; `form.year` is read back with `+` downstream. */
  yearStrings(): string[] {
    return this.years.map(String);
  }

  /**
   * The stored value is the bare grade the valuation engine matches on; the
   * label is the sentence that tells a seller what the grade means.
   */
  readonly conditionOptions: SelectOption[] = [
    { value: 'Excellent', label: 'Excellent — Like new, no issues' },
    { value: 'Good', label: 'Good — Minor wear, fully functional' },
    { value: 'Fair', label: 'Fair — Visible wear, needs minor work' },
    { value: 'Needs Work', label: 'Needs Work — Major repairs needed' },
  ];

  step = signal(1);
  totalSteps = 4;
  submitted = signal(false);
  loading = signal(false);
  submitError = signal('');

  valuation = signal<ValuationResult | null>(null);
  valuationLoading = signal(false);

  uploadedImages = signal<UploadedImage[]>([]);
  uploadLoading = signal(false);

  makes = ['Maruti Suzuki','Hyundai','Tata','Mahindra','Honda','Toyota','Kia','MG Motor','Ford','Volkswagen','Skoda','Renault','Nissan','BMW','Mercedes-Benz','Audi','Other'];
  fuelTypes = ['Petrol','Diesel','CNG','Electric','Hybrid'];
  transmissions = ['Manual','Automatic','AMT','CVT','DCT'];
  ownerOptions = ['1st Owner','2nd Owner','3rd Owner','4th+ Owner'];
  bodyTypes = ['Hatchback','Sedan','SUV','MUV','Coupe','Convertible','Pickup','Van'];

  private modelCatalogue: Record<string, Record<string, string[]>> = {
    'Maruti Suzuki': {
      'Swift':    ['LXi','VXi','ZXi','ZXi+'],
      'Baleno':   ['Sigma','Delta','Zeta','Alpha'],
      'Brezza':   ['LXi','VXi','ZXi','ZXi+'],
      'Ertiga':   ['VXi','ZXi','ZXi+'],
      'WagonR':   ['LXi','VXi','ZXi'],
      'Alto K10': ['STD','LXi','VXi'],
      'Dzire':    ['LXi','VXi','ZXi','ZXi+'],
      'Ciaz':     ['Sigma','Delta','Zeta','Alpha'],
      'S-Presso': ['STD','LXi','VXi'],
      'Celerio':  ['LXi','VXi','ZXi'],
      'Ignis':    ['Sigma','Delta','Zeta','Alpha'],
      'Fronx':    ['Sigma','Delta','Zeta','Alpha'],
      'Grand Vitara': ['E','S','S Hybrid','V Hybrid'],
      'Jimny':    ['Zeta','Alpha'],
      'Ritz':     ['LXi','VXi','ZXi','ZXi+'],
      'Other':    ['Other'],
    },
    'Hyundai': {
      'Creta':    ['E','S','S(O)','SX','SX(O)'],
      'Venue':    ['E','S','S+','SX','SX(O)'],
      'i20':      ['Magna','Sportz','Asta','Asta(O)'],
      'Verna':    ['EX','S','SX','SX(O)'],
      'Alcazar':  ['Prestige','Platinum','Signature'],
      'Grand i10 Nios': ['Magna','Sportz','Asta'],
      'Aura':     ['E','S','SX'],
      'Tucson':   ['Platinum','Signature'],
      'Exter':    ['EX','S','SX','SX(O)'],
      'Other':    ['Other'],
    },
    'Tata': {
      'Nexon':    ['Smart','Pure','Creative','Fearless','Fearless+'],
      'Punch':    ['Pure','Adventure','Accomplished','Creative'],
      'Harrier':  ['Smart','Pure','Adventure','Fearless','Fearless+'],
      'Safari':   ['Smart','Pure+','Adventure+','Accomplished+'],
      'Altroz':   ['XE','XM','XZ','XZ+'],
      'Tigor':    ['XE','XM','XZ','XZ+'],
      'Tiago':    ['XE','XM','XT','XZ'],
      'Nexon EV': ['Medium Range','Long Range','Max LR'],
      'Curvv':    ['Creative','Accomplished','Fearless'],
      'Other':    ['Other'],
    },
    'Mahindra': {
      'Scorpio N':  ['Z2','Z4','Z6','Z8','Z8 L'],
      'XUV700':     ['MX','AX3','AX5','AX7','AX7 L'],
      'Thar':       ['AX (O) STD','AX (O)','LX'],
      'Thar Roxx':  ['MX1','MX3','MX5'],
      'XUV300':     ['W4','W6','W8','W8(O)'],
      'XUV400':     ['EC','EL','EL Pro'],
      'Bolero':     ['B2','B4','B6'],
      'BE6':        ['Pack One','Pack Two','Pack Three'],
      'Other':      ['Other'],
    },
    'Honda': {
      'City':     ['SV','V','VX','ZX'],
      'Amaze':    ['E','S','V','VX'],
      'Elevate':  ['SV','V','VX','ZX'],
      'WR-V':     ['S','V','VX'],
      'Jazz':     ['V','VX','ZX'],
      'Other':    ['Other'],
    },
    'Toyota': {
      'Innova Crysta':  ['GX','VX','ZX'],
      'Innova HyCross': ['G','GX','VX','ZX'],
      'Fortuner':       ['2WD MT','2WD AT','4WD AT','Legender'],
      'Glanza':         ['E','S','G','V'],
      'Urban Cruiser HyRyder': ['E','S','G','V'],
      'Camry':          ['Hybrid'],
      'Other':          ['Other'],
    },
    'Kia': {
      'Seltos':  ['HTK','HTK+','HTX','HTX+','GTX+'],
      'Sonet':   ['HTE','HTK','HTK+','HTX','GTX+'],
      'Carens':  ['Premium','Prestige','Prestige+','Luxury'],
      'EV6':     ['GT Line RWD','GT Line AWD'],
      'Other':   ['Other'],
    },
    'MG Motor': {
      'Hector':  ['Style','Super','Smart','Sharp','Savvy'],
      'Astor':   ['Style','Super','Smart','Sharp'],
      'ZS EV':   ['Excite','Exclusive'],
      'Gloster': ['Super','Sharp','Savvy'],
      'Windsor': ['Excite','Exclusive'],
      'Other':   ['Other'],
    },
    'Volkswagen': {
      'Taigun':  ['Comfortline','Highline','Topline','GT'],
      'Virtus':  ['Comfortline','Highline','Topline','GT'],
      'Polo':    ['Trendline','Comfortline','Highline'],
      'Other':   ['Other'],
    },
    'Skoda': {
      'Kushaq':  ['Active','Ambition','Style'],
      'Slavia':  ['Active','Ambition','Style'],
      'Kodiaq':  ['Sportline','Laurin & Klement'],
      'Other':   ['Other'],
    },
    'Renault': {
      'Kiger':   ['RXE','RXL','RXT','RXZ'],
      'Triber':  ['RXE','RXL','RXT','RXZ'],
      'Duster':  ['RXE','RXL','RXT','RXZ'],
      'Other':   ['Other'],
    },
    'Nissan': {
      'Magnite': ['XE','XL','XV','XV Premium'],
      'Other':   ['Other'],
    },
    'BMW': {
      '3 Series': ['320i','330i','M340i'],
      '5 Series': ['520d','530d','M550d'],
      'X1': ['sDrive18i','xDrive20i'],
      'X3': ['xDrive20i','xDrive30i','M Sport'],
      'X5': ['xDrive40i','xDrive30d','M50i'],
      'Other': ['Other'],
    },
    'Mercedes-Benz': {
      'C-Class': ['C 200','C 220d','C 300'],
      'E-Class': ['E 200','E 220d','E 350'],
      'GLA':     ['200d','220d'],
      'GLC':     ['220d','300d'],
      'GLE':     ['300d','400d'],
      'Other':   ['Other'],
    },
    'Audi': {
      'A4':  ['Premium','Premium Plus','Technology'],
      'A6':  ['Premium','Technology'],
      'Q3':  ['Premium','Premium Plus','Technology'],
      'Q5':  ['Premium','Premium Plus','Technology'],
      'Q7':  ['Premium','Technology'],
      'Other': ['Other'],
    },
    'Ford': {
      'EcoSport': ['Ambiente','Trend','Titanium','S'],
      'Endeavour': ['Trend','Titanium','Sport'],
      'Figo':     ['Ambiente','Trend','Titanium'],
      'Other':    ['Other'],
    },
  };

  get availableModels(): string[] {
    if (!this.form.make || !this.modelCatalogue[this.form.make]) return [];
    return [...Object.keys(this.modelCatalogue[this.form.make]), 'Other'];
  }

  get availableVariants(): string[] {
    if (!this.form.make || !this.form.model) return [];
    return this.modelCatalogue[this.form.make]?.[this.form.model] ?? ['Other'];
  }

  onMakeChange() {
    this.form.model = '';
    this.form.variant = '';
    this.customVariant.set(false);
  }

  onModelChange() {
    this.form.variant = '';
    this.customVariant.set(false);
  }

  /** Sentinel option meaning "the trim I want is not in this list". */
  readonly VARIANT_OTHER = '__type_variant__';

  /** Whether the variant is being typed rather than chosen. */
  customVariant = signal(false);

  /**
   * The trims offered, plus a way out of the list.
   *
   * The catalogue here is a hardcoded map covering some models, so a dealer
   * with genuine showroom stock frequently finds their trim missing — and the
   * field was disabled outright when the map had nothing, which left no way to
   * record it at all. Asked for in UAT: let the variant be typed.
   */
  variantOptions(): SelectOption[] {
    return [
      ...this.availableVariants.map(v => ({ value: v, label: v })),
      { value: this.VARIANT_OTHER, label: '✏️ Type a different variant…' },
    ];
  }

  onVariantPick(value: string) {
    if (value === this.VARIANT_OTHER) {
      this.customVariant.set(true);
      this.form.variant = '';
      return;
    }
    this.customVariant.set(false);
    this.form.variant = value;
  }

  /**
   * Whether step 1 has what it needs.
   *
   * A method rather than a template expression listing fields, because the
   * fields differ by listing type and the expression got this wrong: it
   * required km, owners and condition unconditionally, which are exactly the
   * three a new car hides and clears. The button was therefore permanently
   * disabled for new stock — it looked clickable and did nothing, reported
   * from UAT as "it is not moving forward".
   */
  canLeaveStepOne(): boolean {
    if (this.valuationLoading()) return false;
    if (!this.form.make || !this.form.model || !this.form.fuel) return false;

    return this.isNew()
      ? !!this.form.exShowroomPrice
      : !!(this.form.km && this.form.owners && this.form.condition);
  }

  form = {
    make: '', model: '', variant: '', year: 2020, km: '',
    fuel: '', transmission: '', owners: '', color: '', city: '',
    price: '', description: '', name: '', phone: '', email: '',
    bodyType: '', condition: '',
    exShowroomPrice: '',
  };

  /**
   * New stock or a resale.
   *
   * Every listing this form produced was written as `badge_type: 'used'`,
   * hardcoded, so a dealer with new stock had no way to list it — and forcing
   * it through recorded a brand-new car as second-hand with an invented owner
   * count. The API has modelled `listing_type: new | used` all along and the
   * app already queries both; only this form could not say which.
   */
  listingType = signal<'new' | 'used'>('used');

  isNew(): boolean { return this.listingType() === 'new'; }

  setListingType(type: 'new' | 'used') {
    this.listingType.set(type);
    if (type === 'new') {
      // A new car has none of these. Cleared rather than hidden, so a seller
      // who fills the used form and then switches cannot leave a stale
      // mileage or owner count behind in the submitted row.
      this.form.km = '';
      this.form.owners = '';
      this.form.condition = '';
      this.valuation.set(null);
    } else {
      this.form.exShowroomPrice = '';
    }
  }

  phoneError = signal('');

  validatePhone(): boolean {
    const digits = this.form.phone.replace(/\D/g, '');
    if (digits.length !== 10 && !(digits.length === 12 && digits.startsWith('91'))) {
      this.phoneError.set('Enter a valid 10-digit Indian mobile number');
      return false;
    }
    this.phoneError.set('');
    return true;
  }

  constructor(
    public auth: AuthService,
    private myListings: MyListingsService,
    private router: Router,
    private sb: SupabaseService,
    private imageUpload: ImageUploadService,
    private cityService: CityService,
    private native: NativeService,
  ) {
    const user = auth.currentUser();
    if (user) {
      this.form.name = user.name;
      this.form.email = user.email;
    }
    // Prefill city from navbar selection
    const city = cityService.selectedCity();
    if (city) this.form.city = city;
  }

  get years() {
    const y = [];
    for (let i = new Date().getFullYear(); i >= 2000; i--) y.push(i);
    return y;
  }

  async nextStep() {
    // Valuation prices a used car against depreciation and mileage. Asking it
    // about a new one would return a resale figure for a car nobody has
    // driven, which is worse than showing nothing.
    if (this.step() === 1 && !this.isNew() && !this.valuation()
        && this.form.make && this.form.model && this.form.km && this.form.owners && this.form.condition) {
      await this.fetchValuation();
    }
    if (this.step() < this.totalSteps) this.step.update(v => v + 1);
  }
  prevStep() { if (this.step() > 1) this.step.update(v => v - 1); }

  async fetchValuation() {
    if (!this.form.make || !this.form.model) return;
    this.valuationLoading.set(true);
    try {
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), 8000)
      );
      // Through the API, not straight to a model provider from the browser.
      //
      // This used to call a Supabase Edge Function
      // (`functions.invoke('ai-valuation')`) which held its own Anthropic key.
      // That bypassed the API's Gemini gateway and with it the single place a
      // timeout, a 429 retry and a record of the call can live — and it was a
      // second provider and a second key that no architecture document
      // mentioned. Same job, same response shape, one path.
      const call = fetch(`${environment.apiUrl}/valuation/estimate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          make: this.form.make, model: this.form.model, variant: this.form.variant || null,
          year: Number(this.form.year), km: Number(this.form.km) || 0,
          fuel: this.form.fuel, transmission: this.form.transmission || null,
          owners: Number(this.form.owners) || 1, condition: this.form.condition,
        }),
      }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))));

      const data = await Promise.race([call, timeout]) as any;
      if (data && !data.error) {
        this.valuation.set({ ...(data as ValuationResult), method: data.method ?? 'gemini' });
        if (data.mid && !this.form.price) {
          this.form.price = String(Math.round(data.mid / 1000) * 1000);
        }
        return;
      }
    } catch { /* fall through to heuristic estimate */ }
    finally { this.valuationLoading.set(false); }

    // Shared heuristic fallback — same formula as /ai-valuation page
    const est = computeHeuristicValuation({
      make: this.form.make, model: this.form.model, variant: this.form.variant,
      year: this.form.year, km: this.form.km,
      fuel: this.form.fuel, transmission: this.form.transmission,
      owners: this.form.owners, condition: this.form.condition,
    });
    this.valuation.set(est);
    if (!this.form.price) {
      this.form.price = String(Math.round(est.mid / 1000) * 1000);
    }
  }

  fmt(p: number) { return p >= 100000 ? `₹${(p / 100000).toFixed(1)}L` : `₹${p.toLocaleString('en-IN')}`; }

  uploadError = signal('');

  async onFilesSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files?.length) return;
    const files = Array.from(input.files).slice(0, 10 - this.uploadedImages().length);
    if (!files.length) return;
    this.uploadLoading.set(true);
    this.uploadError.set('');
    try {
      const results = await this.imageUpload.uploadFiles(files, 'cars');
      this.uploadedImages.update(existing => [...existing, ...results]);
    } catch (e: any) {
      this.uploadError.set('Upload failed. Please check your internet connection and try again.');
    } finally {
      this.uploadLoading.set(false);
      input.value = '';
    }
  }

  /**
   * Photographing the car with the phone's camera.
   *
   * Selling a car means standing next to it. On a phone the file input sends
   * the seller to a file browser to look for pictures they have not taken yet;
   * the camera is the obvious first step and Capacitor already exposes it —
   * NativeService wrapped it and nothing called it.
   *
   * `source` picks camera or gallery. Both come back as a data URL, are turned
   * into a File, and go through the same uploader as the web path, so the
   * limits and error handling do not fork.
   */
  async addFromDevice(source: 'camera' | 'gallery'): Promise<void> {
    const remaining = 10 - this.uploadedImages().length;
    if (remaining <= 0 || this.uploadLoading()) return;

    this.uploadError.set('');
    let photo: NativePhoto | null;
    try {
      photo = source === 'camera'
        ? await this.native.takePhoto()
        : await this.native.pickPhoto();
    } catch {
      // Cancelling the camera rejects. That is not a failure worth a message —
      // the seller simply changed their mind.
      return;
    }
    if (!photo) return;

    const file = NativeService.photoToFile(photo);
    if (!file) {
      this.uploadError.set('That photo could not be read. Please try again.');
      return;
    }

    this.uploadLoading.set(true);
    try {
      const results = await this.imageUpload.uploadFiles([file], 'cars');
      this.uploadedImages.update(existing => [...existing, ...results]);
      // Confirmation the photo landed, without the seller having to look away
      // from the car to check the screen.
      this.native.tap('light');
    } catch {
      this.uploadError.set('Upload failed. Please check your internet connection and try again.');
      this.native.buzzError();
    } finally {
      this.uploadLoading.set(false);
    }
  }

  /** True in the Android/iOS shell, where the camera buttons are worth showing. */
  get isNativeApp(): boolean { return this.native.isNative; }

  removeImage(index: number) {
    this.uploadedImages.update(imgs => imgs.filter((_, i) => i !== index));
  }

  imageThumb(url: string) { return url; }

  async onSubmit() {
    if (!this.validatePhone()) return;
    this.loading.set(true);
    this.submitError.set('');
    const user = this.auth.currentUser();
    const imageUrl = this.uploadedImages()[0]?.url ?? null;

    // 1. Insert car row
    const { data: inserted, error: insertError } = await this.sb.client
      .from('cars')
      .insert({
        make: this.form.make,
        model: this.form.model,
        variant: this.form.variant || null,
        year: this.form.year,
        km: this.isNew() ? 0 : +this.form.km,
        fuel: this.form.fuel,
        transmission: this.form.transmission,
        owners: this.isNew() ? null : (this.form.owners || null),
        color: this.form.color || null,
        city: this.form.city || null,
        // For new stock the ex-showroom figure is the price, so it goes in the
        // column that already exists. Deliberately not written to a separate
        // `ex_showroom_price` column: this file cannot see the live schema, and
        // naming a column that may not be there fails the whole insert. If that
        // column does exist on `cars`, moving to it is a one-line change and a
        // migration — see the backlog.
        price: this.isNew() ? (+this.form.exShowroomPrice || 0) : +this.form.price,
        description: this.form.description || null,
        body_type: this.form.bodyType || null,
        // Was hardcoded to 'Used' on every listing this form ever created.
        badge: this.isNew() ? 'New' : 'Used',
        badge_type: this.isNew() ? 'new' : 'used',
        seller_email: this.form.email,
        seller_phone: this.form.phone || null,
        seller_id: user?.sellerId ?? null,
        is_seller_listing: true,
        verified: false,
        rating: 0,
        reviews: 0,
        image_url: imageUrl,
      })
      .select('id')
      .single();

    if (insertError || !inserted) {
      this.submitError.set('Failed to submit listing. Please try again.');
      this.loading.set(false);
      return;
    }

    const carId = inserted.id;

    // 2. Save all uploaded images to car_images table
    const images = this.uploadedImages();
    if (images.length > 0) {
      await this.sb.client.from('car_images').insert(
        images.map((img, i) => ({ car_id: carId, url: img.url, sort_order: i }))
      );
    }

    // 3. Save AI valuation result if available
    const val = this.valuation();
    if (val) {
      await this.sb.client.from('ai_valuation').insert({
        car_id: carId,
        fair_price: val.mid,
        market_min: val.low,
        market_max: val.high,
        verdict: val.marketTrend,
        confidence: val.confidence,
      });
    }

    // 4. Mirror to My Listings (localStorage) so seller sees it immediately
    this.myListings.add({
      make: this.form.make, model: this.form.model, variant: this.form.variant,
      year: this.form.year, km: +this.form.km, fuel: this.form.fuel,
      transmission: this.form.transmission, owners: this.form.owners,
      color: this.form.color, city: this.form.city, price: +this.form.price,
      description: this.form.description, bodyType: this.form.bodyType,
      name: this.form.name, phone: this.form.phone, email: this.form.email,
      supabaseId: carId,
      imageUrl: imageUrl,
    });

    this.loading.set(false);
    this.submitted.set(true);
  }
}
