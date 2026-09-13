import { environment } from '../../../environments/environment';
import { Component, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
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
import { TranslatePipe } from '../../pipes/translate.pipe';

@Component({
  selector: 'app-list-car',
  standalone: true,
  imports: [RouterLink, CommonModule, FormsModule, IconComponent, CustomSelectComponent, TranslatePipe],
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
  /**
   * The listing saved, but something attached to it did not.
   *
   * Separate from submitError because the outcomes differ: an error means
   * nothing was created, a warning means the advert exists but is incomplete.
   * Collapsing them would either hide a real listing or invent a failed one.
   */
  submitWarning = signal('');

  valuation = signal<ValuationResult | null>(null);
  valuationLoading = signal(false);

  uploadedImages = signal<UploadedImage[]>([]);
  uploadLoading = signal(false);

  makes = ['Maruti Suzuki','Hyundai','Tata','Mahindra','Honda','Toyota','Kia','MG Motor','Ford','Volkswagen','Skoda','Renault','Nissan','BMW','Mercedes-Benz','Audi','Other'];
  fuelTypes = ['Petrol','Diesel','CNG','Electric','Hybrid'];

  /**
   * Display label -> `fuel_type` enum label.
   *
   * `cars` carries the fuel twice, and the two halves of the app disagree
   * about which one is real:
   *
   *   fuel       text        written by this form
   *   fuel_type  enum        what the API filters on (routers/cars.py:57)
   *
   * So a car listed here was invisible under Electric no matter what the
   * seller chose — measured in production: both `e Vitara 2026` rows had
   * fuel 'Electric'/'Petrol' and fuel_type NULL, while a row created by the
   * image-upload path (which does set fuel_type) had it the other way round.
   *
   * Writing both keeps the filters working without changing what this form
   * has always stored. Unlike body_type, `fuel` itself stays exactly as the
   * seller picked it — it is text, and rewriting it would alter stored data.
   */
  private readonly FUEL_TYPE_LABELS: Record<string, string> = {
    'Petrol':   'petrol',
    'Diesel':   'diesel',
    'CNG':      'cng',
    'Electric': 'electric',
    'Hybrid':   'hybrid',
  };

  /** The enum label for the chosen fuel, or null. See bodyTypeForDb. */
  fuelTypeForDb(): string | null {
    return this.FUEL_TYPE_LABELS[this.form.fuel] ?? null;
  }

  /**
   * The manufacturer's published price, for new stock only.
   *
   * New Cars drops any catalogue row whose ex_showroom_price is NULL before
   * it looks at anything else (cars-data.service.ts:519), so a new car listed
   * without this was invisible there however correct its fuel or body type.
   *
   * Null, never 0, when nothing was entered: 0 reads as "free" everywhere
   * downstream while NULL reads as "nobody has entered a price" — the
   * distinction the Car model's own comment insists on.
   *
   * Null for used adverts. `price` there is one seller's asking figure for
   * one car; recording it here would state it as the manufacturer's published
   * price for the model, which the discrepancy warnings then trust.
   */
  exShowroomPriceForDb(): number | null {
    if (!this.isNew()) return null;
    return +this.form.exShowroomPrice || null;
  }
  transmissions = ['Manual','Automatic','AMT','CVT','DCT'];

  /**
   * Display label -> `transmission` enum label.
   *
   * `cars.transmission` is a native enum, the same as body_type below, so
   * 'Manual' was rejected exactly as 'SUV' was:
   *   22P02: invalid input value for enum transmission: "Manual"
   *
   * Unlike body_type, every option the dropdown offers has a matching label,
   * so nothing is removed here — this is purely a casing fix.
   *
   * `fuel` deliberately has no equivalent: it is plain `text` in the same
   * table (confirmed by querying information_schema), so 'Petrol' is stored
   * as written and normalising it would change stored data for no reason.
   */
  private readonly TRANSMISSION_LABELS: Record<string, string> = {
    'Manual':    'manual',
    'Automatic': 'automatic',
    'AMT':       'amt',
    'CVT':       'cvt',
    'DCT':       'dct',
  };

  /** The enum label for the chosen gearbox, or null. See bodyTypeForDb. */
  transmissionForDb(): string | null {
    return this.TRANSMISSION_LABELS[this.form.transmission] ?? null;
  }
  ownerOptions = ['1st Owner','2nd Owner','3rd Owner','4th+ Owner'];
  /**
   * Body types a seller can choose.
   *
   * These are exactly the labels of the `body_type` enum in Postgres, in
   * their display casing. Pickup and Van used to be offered here and are not:
   * the enum has no label for either, so choosing one made the whole insert
   * fail with `22P02: invalid input value for enum body_type`. Adding a
   * dropdown entry with no matching label breaks submission for that seller
   * entirely, so this list and BODY_TYPE_LABELS below must stay in step —
   * see list-car.body-type.spec.ts, which fails if they drift apart.
   */
  bodyTypes = ['Hatchback','Sedan','SUV','MUV','Coupe','Convertible'];

  /**
   * Display label -> `body_type` enum label.
   *
   * The column is a native enum (USER-DEFINED / body_type), not text, so
   * Postgres rejects anything that is not one of its labels exactly —
   * casing included. The form has always shown title case and sent it
   * straight through, which is why 'SUV' was rejected.
   *
   * Verified against the live database rather than assumed:
   *   SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
   *    WHERE t.typname = 'body_type';
   *   -> hatchback, sedan, suv, muv, coupe, convertible
   *
   * Only body_type needs this. badge, badge_type, city, color and fuel are
   * plain `text` in the same table — normalising those would change stored
   * data for no reason.
   */
  private readonly BODY_TYPE_LABELS: Record<string, string> = {
    'Hatchback':   'hatchback',
    'Sedan':       'sedan',
    'SUV':         'suv',
    'MUV':         'muv',
    'Coupe':       'coupe',
    'Convertible': 'convertible',
  };

  /**
   * The enum label for what the seller picked, or null.
   *
   * Returns null rather than passing an unknown value through: an unmapped
   * string reaches Postgres and fails the entire insert, losing the listing.
   * A null body type loses one field and saves the advert.
   */
  bodyTypeForDb(): string | null {
    return this.BODY_TYPE_LABELS[this.form.bodyType] ?? null;
  }

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
    // 'Other' is filtered out rather than offered. Every make in the map
    // carries an 'Other' key, and a list also used to append one — either way
    // picking it stored the string "Other" as the model name. See
    // modelOptions() for why that is worse than it looks.
    return Object.keys(this.modelCatalogue[this.form.make])
      .filter(m => m !== 'Other');
  }

  get availableVariants(): string[] {
    if (!this.form.make || !this.form.model) return [];
    return this.modelCatalogue[this.form.make]?.[this.form.model] ?? ['Other'];
  }

  onMakeChange() {
    this.form.model = '';
    this.form.variant = '';
    this.customModel.set(false);
    this.customVariant.set(false);
  }

  onModelChange() {
    this.form.variant = '';
    this.customVariant.set(false);
  }

  /** Sentinel option meaning "the model I want is not in this list". */
  readonly MODEL_OTHER = '__type_model__';

  /** Whether the model is being typed rather than chosen. */
  customModel = signal(false);

  /**
   * The models offered, plus a way out of the list.
   *
   * THE LIST USED TO END IN A LITERAL 'Other', AND THAT WAS THE BUG.
   *
   * modelCatalogue is a hardcoded map covering a fraction of what each
   * manufacturer sells, so a seller with an ordinary car frequently finds it
   * missing. Picking 'Other' stored the string "Other" as the model name —
   * which is worse than refusing the listing, because it succeeds. Images
   * resolve onto catalogue cars by make + model + year, all three exact
   * (services/media_library.py), and New Cars and search match the same way,
   * so a car filed under model "Other" is one no buyer will ever find and no
   * photograph will ever attach to.
   *
   * The escape hatch was the right idea; storing its label as data was not.
   * Same shape as the variant field below, which already solved this.
   */
  modelOptions(): SelectOption[] {
    return [
      ...this.availableModels.map(m => ({ value: m, label: m })),
      { value: this.MODEL_OTHER, label: '✏️ Type a different model…' },
    ];
  }

  onModelPick(value: string) {
    if (value === this.MODEL_OTHER) {
      this.customModel.set(true);
      this.form.model = '';
      this.form.variant = '';
      this.customVariant.set(false);
      return;
    }
    this.customModel.set(false);
    this.form.model = value;
    this.onModelChange();
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

  /**
   * Which fields are keeping Continue disabled, or null when nothing is.
   *
   * Reported from production: "this page is not moving forward". The rule
   * above is right — a new listing needs an ex-showroom price — but nothing
   * on screen said so. The field carried no required marker and the button
   * simply sat there greyed out, so the only way to discover the requirement
   * was to guess which of nine inputs it wanted.
   *
   * This changes no rule. It reads the same conditions canLeaveStepOne()
   * reads and names them.
   *
   * A METHOD, NOT A computed(). These are plain properties on `form` bound
   * with ngModel, and computed() tracks signal reads only — over a plain
   * field it evaluates once and then reports a stale answer forever. That has
   * shipped twice in this repo.
   */
  stepOneBlocker(): string | null {
    // The button already reads "Getting AI estimate…" while this is true, so
    // repeating it underneath would be noise.
    if (this.valuationLoading()) return null;

    const missing: string[] = [];
    if (!this.form.make) missing.push('Make');
    if (!this.form.model) missing.push('Model');
    if (!this.form.fuel) missing.push('Fuel Type');

    if (this.isNew()) {
      if (!this.form.exShowroomPrice) missing.push('Ex-showroom price');
    } else {
      if (!this.form.km) missing.push('Kilometres driven');
      if (!this.form.owners) missing.push('Owners');
      if (!this.form.condition) missing.push('Condition');
    }

    if (!missing.length) return null;
    return missing.length === 1
      ? `${missing[0]} is needed before you can continue.`
      : `These are still needed: ${missing.join(', ')}.`;
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
    // HttpClient, not fetch, and the distinction is load-bearing: the listing
    // POST needs the seller's token, and interceptors/auth.interceptor.ts
    // attaches it to HttpClient requests aimed at environment.apiUrl. The
    // valuation call below uses fetch because that endpoint is public; this
    // one is not, and a fetch() here would arrive unauthenticated and 401.
    // Setting the header by hand is what CLAUDE.md forbids, for the same
    // reason: one hand-attached header is nine missing ones.
    private http: HttpClient,
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

  /**
   * Turn a Supabase insert error into something worth reading.
   *
   * Two audiences, one string. The seller needs to know whether trying again
   * is worth it; whoever fixes it needs the code and the message, and asking
   * a seller to open a browser console is not a support process.
   *
   * 42703 (undefined column) and 42P01 (undefined table) are called out
   * because they are the ones this screen actually hits: it inserts column
   * names straight into Supabase, bypassing the API and the ORM, so nothing
   * checks them against the live schema until Postgres refuses the row.
   */
  private describeSubmitFailure(err: any): string {
    if (!err) {
      return 'The listing could not be saved and the database gave no reason. '
           + 'Please report this.';
    }
    const code = err.code ? ` [${err.code}]` : '';
    const detail = err.message || String(err);

    if (err.code === '42703' || err.code === '42P01') {
      return `This listing form does not match the database${code}: ${detail}. `
           + `Trying again will not help — please report it.`;
    }
    if (err.code === '23502') {
      return `Something required is missing${code}: ${detail}.`;
    }
    if (err.code === '23505') {
      return `This looks like a duplicate${code}: ${detail}.`;
    }
    return `Could not save the listing${code}: ${detail}`;
  }

  /**
   * The grade the API's enum accepts, from the grade this form stores.
   *
   * models/listing.py declares excellent | good | fair | poor. This form has
   * always stored 'Excellent', 'Good', 'Fair' and 'Needs Work' — the values
   * the valuation engine matches on — so passing one straight through is a 422
   * on every submission, and "Needs Work" has no counterpart at all.
   *
   * Mapped rather than renamed at the source: those strings reach
   * valuation-engine.ts and the localStorage mirror, and changing them there
   * would alter an estimate a seller has already been shown.
   */
  private conditionForApi(): string | null {
    const grade = (this.form.condition || '').trim().toLowerCase();
    if (grade === 'needs work') return 'poor';
    return ['excellent', 'good', 'fair', 'poor'].includes(grade) ? grade : null;
  }

  /**
   * The catalogue row a failed submission already committed.
   *
   * The cars insert is not transactional with the listing POST that follows
   * it. Without this, a seller who hits a failed listing and presses submit
   * again inserts a SECOND cars row, and the first is orphaned — so retrying
   * the obvious way quietly fills the catalogue with duplicates of one car.
   * Holding the id makes the retry attach a listing to the row that exists.
   */
  private createdCarId = signal<string | null>(null);

  /**
   * Put the car on the market.
   *
   * WHY THIS EXISTS AT ALL
   *
   * It did not, and that was the bug: this form wrote a `cars` row straight to
   * Supabase and stopped. Used Cars renders /listings?listing_type=used, and
   * no listing was ever created, so a car listed here could not appear there —
   * "0 used cars found" while the seller had just been told "Listing
   * Submitted!". The Render log showed it plainly: no POST /listings in the
   * window at all, because nothing in this file made one.
   *
   * The catalogue row is left exactly as it was. It is what the admin image
   * review and the pricing screens read, and detaching it would trade this bug
   * for another.
   */
  private async createListing(carId: string): Promise<string | null> {
    const body = {
      car_id: carId,
      listing_type: this.listingType(),
      price: this.isNew() ? (+this.form.exShowroomPrice || 0) : +this.form.price,
      negotiable: false,
      // Null rather than 0 for new stock. An advert filed under
      // listing_type=new does not have to carry an odometer reading, and 0 is
      // a reading rather than the absence of one.
      km_driven: this.isNew() ? null : (+this.form.km || 0),
      owners_count: this.isNew() ? null : (+this.form.owners || null),
      condition: this.isNew() ? null : this.conditionForApi(),
      city: this.form.city || null,
      description: this.form.description || null,
    };

    try {
      await firstValueFrom(
        this.http.post<{ id: string }>(`${environment.apiUrl}/listings`, body),
      );
      return null;
    } catch (err: any) {
      const status = err?.status ? ` (${err.status})` : '';
      const detail =
        err?.error?.detail ??
        (typeof err?.error === 'string' ? err.error : '') ??
        err?.message ??
        'unknown error';
      return `${typeof detail === 'string' ? detail : JSON.stringify(detail)}${status}`;
    }
  }

  async onSubmit() {
    if (!this.validatePhone()) return;
    this.loading.set(true);
    this.submitError.set('');
    const user = this.auth.currentUser();
    const imageUrl = this.uploadedImages()[0]?.url ?? null;

    // 1. Insert car row — skipped on a retry after the listing failed, because
    // the row is already committed. Inserting another would orphan the first
    // and put a duplicate of one car into the catalogue on every press of
    // Submit. See createdCarId.
    let carId = this.createdCarId();

    if (!carId) {
      const { data: inserted, error: insertError } = await this.sb.client
        .from('cars')
        .insert({
          make: this.form.make,
          model: this.form.model,
          variant: this.form.variant || null,
          year: this.form.year,
          km: this.isNew() ? 0 : +this.form.km,
          fuel: this.form.fuel,
          // Written alongside `fuel`, not instead of it: this is the column the
          // API filters on, and leaving it NULL is why a listed EV never
          // appeared under Electric. See FUEL_TYPE_LABELS.
          fuel_type: this.fuelTypeForDb(),
          // The enum label, not the display text. See TRANSMISSION_LABELS.
          transmission: this.transmissionForDb(),
          owners: this.isNew() ? null : (this.form.owners || null),
          color: this.form.color || null,
          city: this.form.city || null,
          // For new stock the ex-showroom figure is the price, so it goes here
          // too — `price` is what the used-car views and My Listings read.
          price: this.isNew() ? (+this.form.exShowroomPrice || 0) : +this.form.price,

          // ...and in ex_showroom_price, which is what New Cars requires.
          //
          // The comment that used to sit here said this column was deliberately
          // skipped because "this file cannot see the live schema, and naming a
          // column that may not be there fails the whole insert". That was true
          // when it was written and is not now: the column exists, 017 declares
          // it, and listing-columns.spec.ts holds every inserted column to that.
          //
          // Skipping it made a listed new car invisible on New Cars entirely.
          // cars-data.service.ts:519 drops any catalogue row whose
          // ex_showroom_price is NULL *before* it looks at fuel or body type, so
          // no amount of fixing fuel_type could have made an EV appear — it was
          // never in the list to be filtered.
          //
          // Only for new stock. A used advert's asking price is one seller's
          // number for one car; writing it here would state it as the
          // manufacturer's published price for the model, which it is not.
          ex_showroom_price: this.exShowroomPriceForDb(),
          description: this.form.description || null,
          // The enum label, not the display text. See BODY_TYPE_LABELS.
          body_type: this.bodyTypeForDb(),
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
        // Say what actually went wrong.
        //
        // This used to read "Failed to submit listing. Please try again." and
        // discard `insertError` entirely. Trying again cannot help with the
        // reason it usually fails: this insert names columns directly against
        // Supabase, bypassing the API and the ORM, so a column the live schema
        // does not have rejects the whole row — every time, identically. The
        // advice was not just unhelpful, it was wrong.
        //
        // Postgres says exactly what is wrong ('column "km" of relation "cars"
        // does not exist', code 42703). Showing it costs nothing and turns a
        // support conversation into a one-line fix.
        this.submitError.set(this.describeSubmitFailure(insertError));
        this.loading.set(false);
        return;
      }

        // String(), not a bare assignment: Supabase types the selected id as
        // `any`, which defeats the narrowing on `carId` below and leaves it
        // string | null for the rest of the method.
        carId = String(inserted.id);
      this.createdCarId.set(carId);
    }

    // 2. Put it on the market.
    //
    // A HARD FAILURE, unlike the two follow-ups below, and the difference is
    // the whole point of this step. A missing photograph is a worse advert; a
    // missing LISTING means the car is not for sale anywhere — it appears on
    // no buyer-facing page, and the seller has been told it was submitted.
    // That is the bug this fixes, so reporting it as a footnote would be
    // reproducing it with better wording.
    //
    // The car row stays committed; it is the catalogue entry the photographs
    // attach to, and createdCarId makes a retry reuse it rather than insert a
    // duplicate.
    const listingProblem = await this.createListing(carId);
    if (listingProblem) {
      this.submitError.set(
        `Your car was saved but could not be listed for sale: ${listingProblem}. ` +
        `Nothing has been published yet — press Submit again to retry.`,
      );
      this.loading.set(false);
      return;
    }

    // 3. Save all uploaded images to car_images table
    //
    // These two inserts had their results discarded entirely — not even
    // checked. A listing whose photographs never attached looked identical to
    // one that worked, and the seller found out by looking at their own advert
    // later and seeing no pictures.
    //
    // Reported, but NOT treated as a failure of the submission: the car row is
    // already committed at this point, and refusing the listing now would
    // leave the row orphaned and tell the seller their listing failed when it
    // did not. The listing succeeds; the gap is named.
    const followUpProblems: string[] = [];

    const images = this.uploadedImages();
    if (images.length > 0) {
      const { error: imgError } = await this.sb.client.from('car_images').insert(
        images.map((img, i) => ({ car_id: carId, url: img.url, sort_order: i }))
      );
      if (imgError) {
        followUpProblems.push(
          `photographs (${imgError.message || 'unknown error'})`
        );
      }
    }

    // 3. Save AI valuation result if available
    const val = this.valuation();
    if (val) {
      const { error: valError } = await this.sb.client.from('ai_valuation').insert({
        car_id: carId,
        fair_price: val.mid,
        market_min: val.low,
        market_max: val.high,
        verdict: val.marketTrend,
        confidence: val.confidence,
      });
      if (valError) {
        followUpProblems.push(
          `the AI valuation (${valError.message || 'unknown error'})`
        );
      }
    }

    if (followUpProblems.length) {
      this.submitWarning.set(
        `Your listing was created, but ${followUpProblems.join(' and ')} could ` +
        `not be saved with it.`
      );
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
