import { Component, signal, OnDestroy, effect, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { SeoService } from '../../services/seo.service';
import { DiagnosisService, DiagnoseRequest } from '../../services/diagnosis.service';
import { AuthService } from '../../services/auth.service';
import { SupabaseService } from '../../services/supabase.service';
import { CityService } from '../../services/city.service';
import { ApiService } from '../../services/api.service';
import { OfflineQueueService } from '../../services/offline-queue.service';
import { VoiceDiagnosisService, VOICE_LANGUAGES, VoiceLanguage } from '../../services/voice-diagnosis.service';
import { IconComponent } from '../../components/icon/icon.component';
import { VoiceModeComponent, VoiceSessionResult } from '../../components/voice-mode/voice-mode.component';
import { firstValueFrom } from 'rxjs';
import { CustomSelectComponent } from '../../components/custom-select/custom-select.component';
import { ServiceRequestComponent } from '../../components/service-request/service-request.component';
import { TranslatePipe } from '../../pipes/translate.pipe';
import { LanguageService } from '../../services/language.service';

interface ServiceCenter {
  name: string;
  address: string;
  phone: string;
  hours: string;
  lat: number;
  lng: number;
  distance?: number; // km, filled at runtime
}

const SERVICE_CENTERS: Record<string, Record<string, ServiceCenter[]>> = {
  'Maruti Suzuki': {
    'Mumbai': [
      { name: 'Mandve Motors (Maruti Suzuki)', address: 'Plot No. 2, Sector 19A, Nerul, Navi Mumbai – 400706', phone: '022-27700200', hours: 'Mon–Sat 8am–7pm', lat: 19.0330, lng: 73.0297 },
      { name: 'Bimal Auto Agency', address: 'Dr. Annie Besant Road, Worli, Mumbai – 400018', phone: '022-24966200', hours: 'Mon–Sat 9am–6pm', lat: 19.0096, lng: 72.8174 },
    ],
    'Delhi': [
      { name: 'Competent Automobiles', address: 'A-1/2, Lawrence Road Industrial Area, Delhi – 110035', phone: '011-47060000', hours: 'Mon–Sat 8am–7pm', lat: 28.7041, lng: 77.1025 },
      { name: 'Rohan Motors', address: 'Plot 4, Pocket 2, Sector 22, Rohini, Delhi – 110086', phone: '011-27046789', hours: 'Mon–Sat 9am–6pm', lat: 28.7329, lng: 77.0888 },
    ],
    'Bangalore': [
      { name: 'Mandovi Motors', address: '3rd Cross, Sadashivanagar, Bangalore – 560080', phone: '080-23610101', hours: 'Mon–Sat 8am–7pm', lat: 13.0100, lng: 77.5756 },
      { name: 'Indus Motors', address: 'Outer Ring Road, Marathahalli, Bangalore – 560037', phone: '080-25230101', hours: 'Mon–Sat 9am–6pm', lat: 12.9591, lng: 77.6974 },
    ],
    'Hyderabad': [
      { name: 'Popular Maruti', address: '6-3-354/1, Rd No. 1, Banjara Hills, Hyderabad – 500034', phone: '040-23559900', hours: 'Mon–Sat 8am–7pm', lat: 17.4156, lng: 78.4347 },
    ],
    'Chennai': [
      { name: 'Akshaya Automobiles', address: '7, Arcot Road, Vadapalani, Chennai – 600026', phone: '044-43101010', hours: 'Mon–Sat 8am–7pm', lat: 13.0524, lng: 80.2137 },
    ],
    'Pune': [
      { name: 'Navnit Motors', address: 'Survey No. 28, Nagar Road, Viman Nagar, Pune – 411014', phone: '020-66013333', hours: 'Mon–Sat 8am–7pm', lat: 18.5679, lng: 73.9143 },
    ],
    'New Town': [
      { name: 'Mandve Motors Kolkata', address: 'AA-1, Sector II, Salt Lake, Kolkata – 700091', phone: '033-23589900', hours: 'Mon–Sat 8am–7pm', lat: 22.5726, lng: 88.4099 },
    ],
  },
  'Hyundai': {
    'Mumbai': [
      { name: 'Solitaire Hyundai', address: 'Plot 31, MIDC, Andheri East, Mumbai – 400093', phone: '022-42006700', hours: 'Mon–Sat 8am–7pm', lat: 19.1136, lng: 72.8697 },
    ],
    'Delhi': [
      { name: 'Kggs Hyundai', address: '1103, Main Mathura Road, Badarpur, New Delhi – 110044', phone: '011-29946000', hours: 'Mon–Sat 9am–6pm', lat: 28.5041, lng: 77.2960 },
    ],
    'Bangalore': [
      { name: 'Trident Hyundai', address: 'No. 1, Hosur Road, Bommanahalli, Bangalore – 560068', phone: '080-49000000', hours: 'Mon–Sat 8am–7pm', lat: 12.8990, lng: 77.6271 },
    ],
    'Hyderabad': [
      { name: 'VW Hyundai', address: 'Plot 7, Ameerpet, Hyderabad – 500016', phone: '040-66360000', hours: 'Mon–Sat 8am–7pm', lat: 17.4374, lng: 78.4487 },
    ],
    'Chennai': [
      { name: 'Kun Hyundai', address: 'No. 1, GST Road, Chromepet, Chennai – 600044', phone: '044-22380000', hours: 'Mon–Sat 8am–7pm', lat: 12.9507, lng: 80.1420 },
    ],
    'Pune': [
      { name: 'Dhoot Hyundai', address: 'Survey No. 98, Nagar Road, Wagholi, Pune – 412207', phone: '020-27050000', hours: 'Mon–Sat 8am–7pm', lat: 18.5562, lng: 74.0025 },
    ],
    'New Town': [
      { name: 'Hyundai Service Kolkata', address: 'DG-5, Action Area I, New Town, Kolkata – 700156', phone: '033-40019900', hours: 'Mon–Sat 8am–7pm', lat: 22.5839, lng: 88.4788 },
    ],
  },
  'Tata': {
    'Mumbai': [
      { name: 'Tata Motors Service Centre', address: 'Plot 46, TTC Industrial Area, Navi Mumbai – 400710', phone: '022-27694000', hours: 'Mon–Sat 8am–7pm', lat: 19.0760, lng: 73.0000 },
    ],
    'Delhi': [
      { name: 'Concorde Motors', address: 'A-24, Mohan Co-operative Industrial Estate, New Delhi – 110044', phone: '011-41625555', hours: 'Mon–Sat 9am–6pm', lat: 28.5355, lng: 77.2590 },
    ],
    'Bangalore': [
      { name: 'Prerana Motors', address: 'No. 6, Residency Road, Bangalore – 560025', phone: '080-22117777', hours: 'Mon–Sat 8am–7pm', lat: 12.9719, lng: 77.5937 },
    ],
    'Hyderabad': [
      { name: 'Concorde Motors Hyderabad', address: '6-3-571, Rockdale Compound, Somajiguda, Hyderabad – 500082', phone: '040-23399999', hours: 'Mon–Sat 8am–7pm', lat: 17.4318, lng: 78.4612 },
    ],
    'Chennai': [
      { name: 'Tata Motors Works', address: 'No. 48, Mount Road, Chennai – 600002', phone: '044-28521234', hours: 'Mon–Sat 8am–7pm', lat: 13.0604, lng: 80.2496 },
    ],
    'Pune': [
      { name: 'Tata Motors Authorized Service', address: 'Plot 4, Hadapsar Industrial Estate, Pune – 411013', phone: '020-26871234', hours: 'Mon–Sat 8am–7pm', lat: 18.5074, lng: 73.9399 },
    ],
    'New Town': [
      { name: 'Tata Motors Kolkata', address: 'Plot Y-1, Block EP, Sector V, Salt Lake, Kolkata – 700091', phone: '033-40047200', hours: 'Mon–Sat 8am–7pm', lat: 22.5726, lng: 88.4350 },
    ],
  },
};

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * How far an "authorised centre near you" may actually be.
 *
 * A driver whose car will not start needs somewhere they can reach today, so
 * a centre outside their own metro is not a weaker answer — it is the wrong
 * answer. Without this cap the list was simply the nearest three rows in the
 * table wherever they were: a driver in New Town, Kolkata was shown Salt Lake
 * (4.9 km), then Hyderabad at 1,193 km and Delhi at 1,325 km, each carrying a
 * phone number that answers in a different state.
 *
 * 60 km covers a metro and its outskirts — Salt Lake to Howrah, or across the
 * Mumbai belt — without reaching the next city.
 */
const SERVICE_AREA_KM = 60;

function getServiceCenters(manufacturer: string, city: string): ServiceCenter[] {
  const byMake = SERVICE_CENTERS[manufacturer] ?? SERVICE_CENTERS['Maruti Suzuki'];
  // No cross-city fallback. This used to return the first city in the table —
  // Mumbai — for anywhere unlisted, which is where the Mumbai numbers shown to
  // a Kolkata driver came from. An empty list says "we don't know", which is
  // true; a Mumbai list says "here is your centre", which is not.
  return byMake[city] ?? [];
}

function getAllServiceCenters(manufacturer: string): ServiceCenter[] {
  const byMake = SERVICE_CENTERS[manufacturer] ?? SERVICE_CENTERS['Maruti Suzuki'];
  return Object.values(byMake).flat();
}

const WARNING_LIGHTS = [
  'Check Engine (MIL)', 'Oil Pressure', 'Battery / Charging', 'Temperature / Overheat',
  'Brake Warning', 'ABS Warning', 'Airbag / SRS', 'TPMS (Tyre Pressure)',
  'Transmission Warning', 'DPF Warning', 'EV Battery Warning', 'Service Due',
  'Fuel Low', 'Power Steering', 'ADAS / Lane Warning',
];

const WHEN_OPTIONS = [
  'Cold Start', 'Hot Start', 'After Warm-Up', 'Idle / Stationary',
  'Low Speed Driving', 'Highway Driving', 'Braking', 'Acceleration',
  'Turning / Cornering', 'Gear Change', 'Going Uphill', 'Going Downhill',
  'AC On', 'Rainy / Wet Conditions', 'Always / Constantly',
];

const MODELS_BY_MAKE: Record<string, string[]> = {
  'Maruti Suzuki': ['Alto', 'Alto K10', 'S-Presso', 'Celerio', 'WagonR', 'Swift', 'Dzire', 'Ignis', 'Baleno', 'Fronx', 'Jimny', 'Brezza', 'Ertiga', 'XL6', 'Grand Vitara', 'Invicto', 'Ritz', 'Ciaz', 'Omni', 'Eeco'],
  'Hyundai': ['Santro', 'Grand i10 Nios', 'i20', 'Aura', 'Verna', 'Creta', 'Alcazar', 'Tucson', 'Ioniq 5', 'Ioniq 6', 'Venue', 'Exter', 'i10'],
  'Tata': ['Tiago', 'Tigor', 'Altroz', 'Nexon', 'Punch', 'Harrier', 'Safari', 'Curvv', 'Sierra EV', 'Avinya', 'Nexon EV', 'Tiago EV', 'Tigor EV', 'Sumo', 'Indica', 'Indigo'],
  'Kia': ['Sonet', 'Seltos', 'Carens', 'EV6', 'EV9', 'Carnival'],
  'MG': ['Hector', 'Hector Plus', 'Astor', 'ZS EV', 'Comet EV', 'Gloster', 'Windsor EV'],
  'Toyota': ['Glanza', 'Rumion', 'Urban Cruiser Hyryder', 'Innova Crysta', 'Innova HyCross', 'Fortuner', 'Camry', 'Vellfire', 'Land Cruiser', 'Hilux', 'Etios', 'Corolla'],
  'Honda': ['Amaze', 'City', 'Elevate', 'Jazz', 'WR-V', 'CR-V', 'Accord', 'Brio', 'Mobilio'],
  'Mahindra': ['Bolero', 'Bolero Neo', 'Scorpio', 'Scorpio N', 'Scorpio Classic', 'Thar', 'XUV300', 'XUV400', 'XUV700', 'BE 6', 'XEV 9e', 'Marazzo', 'KUV100', 'TUV300', 'Verito'],
  'Skoda': ['Kushaq', 'Slavia', 'Kodiaq', 'Superb', 'Octavia', 'Rapid', 'Fabia'],
  'Volkswagen': ['Taigun', 'Virtus', 'Tiguan', 'Vento', 'Polo', 'Ameo'],
  'Renault': ['Kwid', 'Triber', 'Kiger', 'Duster', 'Lodgy'],
  'Nissan': ['Magnite', 'Kicks', 'Terrano', 'Micra', 'Sunny'],
  'Ford': ['Figo', 'Aspire', 'Freestyle', 'EcoSport', 'Endeavour', 'Mustang'],
  'Jeep': ['Compass', 'Meridian', 'Wrangler', 'Grand Cherokee'],
  'Isuzu': ['D-Max', 'MU-X', 'MU-7'],
  'Other': ['Other'],
};

const VARIANTS_BY_MODEL: Record<string, string[]> = {
  'Swift': ['LXi', 'VXi', 'VXi AMT', 'ZXi', 'ZXi+', 'ZXi AMT', 'ZXi+ AMT'],
  'Dzire': ['LXi', 'VXi', 'ZXi', 'ZXi+', 'VXi AMT', 'ZXi AMT', 'ZXi+ AMT'],
  'Baleno': ['Sigma', 'Delta', 'Delta MT', 'Zeta', 'Alpha', 'Alpha MT'],
  'WagonR': ['LXi', 'VXi', 'VXi+', 'ZXi', 'ZXi+'],
  'Brezza': ['LXi', 'VXi', 'ZXi', 'ZXi+', 'ZXi+ Dual Tone'],
  'Grand Vitara': ['Sigma', 'Delta', 'Zeta', 'Alpha', 'Alpha+'],
  'Creta': ['E', 'EX', 'S', 'S(O)', 'SX', 'SX Tech', 'SX(O)', 'SX(O) Connect', 'Knight Edition'],
  'i20': ['Era', 'Magna', 'Sportz', 'Asta', 'Asta(O)'],
  'Venue': ['E', 'S', 'S+', 'SX', 'SX+', 'SX(O)'],
  'Verna': ['EX', 'S', 'S+', 'SX', 'SX Tech', 'SX(O)'],
  'Nexon': ['Smart', 'Smart+', 'Pure', 'Pure+', 'Creative', 'Creative+', 'Fearless', 'Fearless+', 'Fearless+ S'],
  'Punch': ['Pure', 'Adventure', 'Accomplished', 'Creative'],
  'Tiago': ['XE', 'XM', 'XM+', 'XT', 'XZ', 'XZ+'],
  'Altroz': ['XE', 'XM', 'XM+', 'XT', 'XT+', 'XZ', 'XZ+', 'XZ+ Lux'],
  'Harrier': ['Smart', 'Pure', 'Adventure', 'Accomplished', 'Fearless', 'Fearless+'],
  'Safari': ['Smart', 'Pure', 'Adventure', 'Accomplished', 'Fearless', 'Fearless+'],
  'Sonet': ['HTE', 'HTK', 'HTK+', 'HTX', 'HTX+', 'GTX+', 'X-Line'],
  'Seltos': ['HTE', 'HTK', 'HTK+', 'HTX', 'HTX+', 'GTX', 'GTX+', 'X-Line'],
  'Hector': ['Style', 'Smart', 'Sharp', 'Sharp Pro', 'Select Pro', 'Savvy Pro'],
  'Fortuner': ['2.7 4x2 MT', '2.7 4x2 AT', '2.8 4x2 MT', '2.8 4x2 AT', '2.8 4x4 MT', '2.8 4x4 AT', 'Legender'],
  'Innova Crysta': ['GX', 'VX', 'ZX'],
  'City': ['S', 'V', 'VX', 'ZX', 'Hybrid V', 'Hybrid ZX'],
  'Amaze': ['E', 'S', 'V', 'VX', 'SV'],
  'Scorpio N': ['Z2', 'Z4', 'Z6', 'Z8', 'Z8 L'],
  'Thar': ['AX (O)', 'LX', 'LX Hard Top', 'LX Hard Top Diesel AT'],
  'XUV700': ['MX', 'AX3', 'AX5', 'AX7', 'AX7 L'],
  'Kushaq': ['Active', 'Ambition', 'Style', 'Monte Carlo'],
  'Taigun': ['Comfortline', 'Trendline', 'Highline', 'Topline', 'GT', 'GT Plus'],
  'Virtus': ['Dynamic', 'Comfortline', 'Trendline', 'Highline', 'Topline', 'GT', 'GT Plus'],
  'Magnite': ['XE', 'XL', 'XV', 'XV Premium', 'XV Premium Opt'],
  'Kiger': ['RXE', 'RXL', 'RXT', 'RXZ', 'RXZ Dual Tone'],
  'Ritz': ['LXi', 'VXi', 'ZXi', 'VDi', 'ZDi'],
  'Other': ['Other'],
};

const MAKES = Object.keys(MODELS_BY_MAKE);

@Component({
  selector: 'app-vehicle-diagnosis',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, CustomSelectComponent, VoiceModeComponent, ServiceRequestComponent, IconComponent, TranslatePipe],
  templateUrl: './vehicle-diagnosis.component.html',
  styleUrl: './vehicle-diagnosis.component.scss',
})
export class VehicleDiagnosisComponent implements OnDestroy {
  private readonly lang = inject(LanguageService);
  step = signal(1);
  totalSteps = 4;

  // Step 1 — Vehicle details
  form = {
    manufacturer: '', model: '', variant: '', model_year: String(new Date().getFullYear() - 2),
    fuel_type: '', transmission: '', odometer_km: null as number | null,
  };

  // Step 2 — Symptoms
  problemDescription = '';
  /**
   * Follow-up questions to show as prompts beside the description box.
   * Deliberately separate from `problemDescription`: what the driver said and
   * what we asked are different things, and only the first should be diagnosed.
   */
  followUpPrompts = signal<string[]>([]);
  selectedWarningLights = signal<string[]>([]);
  selectedWhenOccurs = signal<string[]>([]);
  severity = 'medium';

  // Step 3 — Confirm
  // Step 4 — Report (auto-loaded)

  warningLights = WARNING_LIGHTS;
  whenOptions = WHEN_OPTIONS;
  makes = MAKES;
  fuelTypes = ['Petrol', 'Diesel', 'CNG', 'Electric', 'Hybrid', 'LPG'];
  transmissions = ['Manual', 'Automatic', 'CVT', 'DCT', 'AMT'];
  severities = [
    { value: 'low', label: 'Low', desc: 'Slight inconvenience, car drives fine' },
    { value: 'medium', label: 'Medium', desc: 'Noticeable issue, drivability affected' },
    { value: 'high', label: 'High', desc: 'Significant problem, use with caution' },
    { value: 'critical', label: 'Critical', desc: 'Dangerous — do not drive' },
  ];

  years = Array.from({ length: 35 }, (_, i) => String(new Date().getFullYear() - i));

  get models(): string[] {
    return MODELS_BY_MAKE[this.form.manufacturer] ?? [];
  }

  get variants(): string[] {
    return VARIANTS_BY_MODEL[this.form.model] ?? [];
  }

  onMakeChange() {
    this.form.model = '';
    this.form.variant = '';
  }

  onModelChange() {
    this.form.variant = '';
  }

  get step1Valid(): boolean {
    return !!this.form.manufacturer && !!this.form.model && !!this.form.fuel_type && !!this.form.transmission;
  }

  get step2Valid(): boolean {
    return this.problemDescription.trim().length >= 10;
  }

  // Photo upload
  selectedImages = signal<File[]>([]);
  imageThumbs = signal<string[]>([]);

  onPhotoChange(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files) return;
    const files = Array.from(input.files).slice(0, 5);
    this.selectedImages.set(files);
    // Generate data-URL previews
    const thumbs: string[] = [];
    files.forEach(f => {
      const reader = new FileReader();
      reader.onload = e => {
        thumbs.push(e.target!.result as string);
        if (thumbs.length === files.length) this.imageThumbs.set([...thumbs]);
      };
      reader.readAsDataURL(f);
    });
    if (files.length === 0) this.imageThumbs.set([]);
  }

  clearImages(event: MouseEvent) {
    event.stopPropagation();
    this.selectedImages.set([]);
    this.imageThumbs.set([]);
  }

  // ── Maintenance history (BR-IR-07) ────────────────────────────────────────

  maintenanceHistory = signal<{ item: string; date: string; odometer_km: number | null }[]>([]);
  newMaintItem = '';
  newMaintDate = '';
  newMaintOdo: number | null = null;

  addMaintenanceEntry() {
    const item = this.newMaintItem.trim();
    if (!item) return;
    // Server caps at 20; stop here so the request cannot 422.
    if (this.maintenanceHistory().length >= 20) return;
    this.maintenanceHistory.update(list => [
      ...list,
      { item, date: this.newMaintDate.trim(), odometer_km: this.newMaintOdo },
    ]);
    this.newMaintItem = '';
    this.newMaintDate = '';
    this.newMaintOdo = null;
  }

  removeMaintenanceEntry(index: number) {
    this.maintenanceHistory.update(list => list.filter((_, i) => i !== index));
  }

  // ── Audio / video attachments (TC-F-12, TC-F-13) ─────────────────────────

  selectedAudio = signal<File | null>(null);
  selectedVideo = signal<File | null>(null);

  // Kept in step with the server-side caps in routers/upload.py.
  private readonly MAX_AUDIO_BYTES = 25 * 1024 * 1024;
  private readonly MAX_VIDEO_BYTES = 75 * 1024 * 1024;

  mediaError = signal('');

  onAudioChange(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    if (file && file.size > this.MAX_AUDIO_BYTES) {
      this.mediaError.set('Audio must be under 25 MB.');
      input.value = '';
      return;
    }
    this.mediaError.set('');
    this.selectedAudio.set(file);
  }

  onVideoChange(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    if (file && file.size > this.MAX_VIDEO_BYTES) {
      this.mediaError.set('Video must be under 75 MB.');
      input.value = '';
      return;
    }
    this.mediaError.set('');
    this.selectedVideo.set(file);
  }

  clearAudio(event: MouseEvent) {
    event.stopPropagation();
    this.selectedAudio.set(null);
  }

  clearVideo(event: MouseEvent) {
    event.stopPropagation();
    this.selectedVideo.set(null);
  }

  formatBytes(n: number): string {
    if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
    return `${Math.round(n / 1024)} KB`;
  }

  serviceCenterModal = signal(false);
  /**
   * Which half of the "find help" modal is showing.
   *
   * Defaults to the GAADIIQ mechanic network rather than the hardcoded
   * dealership list: the network can actually take the job, quote it and be
   * paid, whereas the authorised centres are a reference list the user has to
   * chase themselves. The old list stays as the fallback for areas with no
   * registered mechanics yet.
   */
  helpTab = signal<'mechanics' | 'authorised'>('mechanics');
  nearbyServiceCenters = signal<ServiceCenter[]>([]);

  // Diagnosis history (MOB-036)
  showHistory = signal(false);
  history = signal<any[]>([]);
  historyLoading = signal(false);

  // Voice input
  voiceLanguages = VOICE_LANGUAGES;
  voiceLangOpen = signal(false);
  showVoiceMode = signal(false);
  private _voiceDetectedLang = 'en-IN';

  /** What language the assessment itself should come back in. */
  private diagnosisLanguage(): string | undefined {
    if (this._voiceDetectedLang !== 'en-IN') return this._voiceDetectedLang;
    return this.lang.lang() === 'hi' ? 'hi-IN' : undefined;
  }

  /**
   * How this diagnosis was entered. Drives whether the report is spoken
   * unprompted: 'voice' auto-plays, 'manual' stays silent until the user
   * asks for audio.
   */
  inputMode = signal<'manual' | 'voice'>('manual');

  /** User explicitly chose the typed form. */
  chooseManualMode() {
    this.inputMode.set('manual');
    this.voice.stopSpeaking();
  }

  constructor(
    private seo: SeoService,
    public diagSvc: DiagnosisService,
    protected auth: AuthService,
    private sb: SupabaseService,
    public city: CityService,
    private api: ApiService,
    public voice: VoiceDiagnosisService,
    public offline: OfflineQueueService,
  ) {
    seo.setPage(
      'AI Vehicle Diagnosis',
      'Describe your car problem and get an instant AI-powered preliminary diagnosis with repair cost estimates.',
    );

    // Auto-play TTS when a new diagnosis report arrives (respects mute preference)
    effect(() => {
      const report = this.diagSvc.report();
      if (!report || this.step() !== 4 || this.diagSvc.loading()) return;

      // Only speak the report unprompted when the user chose the voice flow.
      // Someone who filled the form by hand is looking at the screen — reading
      // it aloud at them is intrusive. They can still tap play on the TTS bar.
      if (this.inputMode() !== 'voice') return;

      this.voice.speak(this._buildTtsText(report));
    });
  }

  openHistory() {
    this.showHistory.set(true);
    this.historyLoading.set(true);
    this.diagSvc.getHistory().subscribe({
      next: h => { this.history.set(h); this.historyLoading.set(false); },
      error: () => { this.history.set([]); this.historyLoading.set(false); },
    });
  }

  closeHistory() {
    this.showHistory.set(false);
    this.historyDetail.set(null);
    this.historyDetailError.set('');
  }

  // ── Past diagnosis detail (BR-UX-03) ──────────────────────────────────────

  historyDetail = signal<any | null>(null);
  historyDetailLoading = signal(false);
  historyDetailError = signal('');

  /** Open one past report in full. The list stays mounted behind the detail. */
  openHistoryDetail(id: string) {
    this.historyDetail.set(null);
    this.historyDetailError.set('');
    this.historyDetailLoading.set(true);
    this.diagSvc.getDiagnosis(id).subscribe({
      next: (report) => {
        this.historyDetail.set(report);
        this.historyDetailLoading.set(false);
      },
      error: (err) => {
        this.historyDetailLoading.set(false);
        this.historyDetailError.set(
          err?.status === 403
            ? 'You do not have access to this diagnosis.'
            : err?.status === 404
              ? 'This diagnosis is no longer available.'
              : 'Could not load this diagnosis. Please try again.'
        );
      },
    });
  }

  // ── DPDP controls (BR-SEC-05, BR-SEC-06) ──────────────────────────────────

  deleteBusy = signal(false);
  deleteMessage = signal('');
  confirmDeleteId = signal<string | null>(null);
  confirmVoiceWipe = signal(false);

  askDeleteDiagnosis(id: string) {
    this.confirmDeleteId.set(id);
    this.deleteMessage.set('');
  }

  cancelDelete() {
    this.confirmDeleteId.set(null);
    this.confirmVoiceWipe.set(false);
  }

  /** Delete one saved report, then refresh the list (BR-SEC-05). */
  confirmDeleteDiagnosis() {
    const id = this.confirmDeleteId();
    if (!id) return;
    this.deleteBusy.set(true);
    this.diagSvc.deleteDiagnosis(id).subscribe({
      next: () => {
        this.deleteBusy.set(false);
        this.confirmDeleteId.set(null);
        this.historyDetail.set(null);
        this.deleteMessage.set('Diagnosis deleted.');
        this.openHistory();
      },
      error: () => {
        this.deleteBusy.set(false);
        this.confirmDeleteId.set(null);
        this.deleteMessage.set('Could not delete that diagnosis. Please try again.');
      },
    });
  }

  askVoiceWipe() {
    this.confirmVoiceWipe.set(true);
    this.deleteMessage.set('');
  }

  /** Erase all stored voice data and revoke consent locally too (BR-SEC-06). */
  confirmVoiceDataWipe() {
    this.deleteBusy.set(true);
    this.diagSvc.deleteVoiceData().subscribe({
      next: (res) => {
        this.deleteBusy.set(false);
        this.confirmVoiceWipe.set(false);
        // Server consent is revoked; clear the local copy so the notice is
        // shown again before any further capture.
        this.voice.revokeConsent();
        this.deleteMessage.set(
          `Deleted ${res.transcripts_deleted} voice transcript(s) across ` +
          `${res.conversations_deleted} conversation(s). Microphone consent has been withdrawn.`
        );
      },
      error: () => {
        this.deleteBusy.set(false);
        this.confirmVoiceWipe.set(false);
        this.deleteMessage.set('Could not delete your voice data. Please try again.');
      },
    });
  }

  /** Back to the list without closing the panel. */
  closeHistoryDetail() {
    this.historyDetail.set(null);
    this.historyDetailError.set('');
  }

  /** Read a past report aloud, reusing the report TTS text builder. */
  speakHistoryDetail() {
    const report = this.historyDetail();
    if (report) this.voice.speak(this._buildTtsText(report));
  }

  toggleWarningLight(light: string) {
    this.selectedWarningLights.update(list =>
      list.includes(light) ? list.filter(l => l !== light) : [...list, light]
    );
  }

  toggleWhenOccurs(when: string) {
    this.selectedWhenOccurs.update(list =>
      list.includes(when) ? list.filter(w => w !== when) : [...list, when]
    );
  }

  next() {
    if (this.step() < this.totalSteps) this.step.update(s => s + 1);
  }

  back() {
    if (this.step() > 1) this.step.update(s => s - 1);
  }

  async submit() {
    const { data } = await this.sb.client.auth.getSession();
    const userId = data.session?.user?.id;

    // Upload images to R2 before submitting diagnosis
    const uploadedUrls: string[] = [];
    for (const file of this.selectedImages()) {
      try {
        const result = await firstValueFrom(this.api.uploadDiagnosisImage(file));
        if (result?.url) uploadedUrls.push(result.url);
      } catch {
        // Non-fatal: fall back to no image URL for this file
      }
    }

    // Upload audio / video attachments (non-fatal: a failed upload must not
    // block the diagnosis itself).
    let audioUrl: string | undefined;
    let videoUrl: string | undefined;
    const audioFile = this.selectedAudio();
    if (audioFile) {
      try {
        const res = await firstValueFrom(this.api.uploadDiagnosisAudio(audioFile));
        audioUrl = res?.url;
      } catch { /* proceed without the recording */ }
    }
    const videoFile = this.selectedVideo();
    if (videoFile) {
      try {
        const res = await firstValueFrom(this.api.uploadDiagnosisVideo(videoFile));
        videoUrl = res?.url;
      } catch { /* proceed without the clip */ }
    }

    const request: DiagnoseRequest = {
      manufacturer: this.form.manufacturer,
      model: this.form.model,
      variant: this.form.variant || undefined,
      model_year: Number(this.form.model_year),
      fuel_type: this.form.fuel_type,
      transmission: this.form.transmission,
      odometer_km: this.form.odometer_km ?? undefined,
      problem_description: this.problemDescription,
      warning_lights: this.selectedWarningLights(),
      when_occurs: this.selectedWhenOccurs(),
      severity: this.severity,
      maintenance_history: this.maintenanceHistory().length
        ? this.maintenanceHistory().map(m => ({
            item: m.item,
            ...(m.date ? { date: m.date } : {}),
            ...(m.odometer_km ? { odometer_km: m.odometer_km } : {}),
          }))
        : undefined,
      user_id: userId,
      image_urls: uploadedUrls.length > 0 ? uploadedUrls : undefined,
      audio_url: audioUrl,
      video_url: videoUrl,
      // Voice detection wins — it is evidence of the language actually spoken.
      // Failing that, the language the user picked in the navbar. The backend
      // already asks the model to answer in this language rather than
      // translating afterwards (services/diagnosis.py), so without this a
      // Hindi reader got a Hindi interface wrapped around an English
      // diagnosis — the one part of the page they most need to understand.
      detected_language: this.diagnosisLanguage(),
    };

    this.step.set(4);

    // Offline: queue the submission so it is not lost, and say so plainly
    // rather than showing a failure the user can do nothing about (BR-UX-06).
    if (!this.offline.online()) {
      this.offline.enqueue(
        `${this.api.baseUrl}/diagnosis/analyse`, 'POST', request
      );
      this.queuedOffline.set(true);
      return;
    }
    this.queuedOffline.set(false);

    await this.diagSvc.analyse(request);
  }

  /** True when the last submission was queued instead of sent (BR-UX-06). */
  queuedOffline = signal(false);

  reset() {
    this.step.set(1);
    this.form = { manufacturer: '', model: '', variant: '', model_year: String(new Date().getFullYear() - 2), fuel_type: '', transmission: '', odometer_km: null };
    this.problemDescription = '';
    this.followUpPrompts.set([]);
    this.selectedWarningLights.set([]);
    this.selectedWhenOccurs.set([]);
    this.severity = 'medium';
    this.selectedImages.set([]);
    this.imageThumbs.set([]);
    this.selectedAudio.set(null);
    this.selectedVideo.set(null);
    this.mediaError.set('');
    this.inputMode.set('manual');
    this.maintenanceHistory.set([]);
    this.newMaintItem = ''; this.newMaintDate = ''; this.newMaintOdo = null;
    this.diagSvc.report.set(null);
    this.diagSvc.error.set(null);
  }

  bookService() {
    const make = this.form.manufacturer || 'Maruti Suzuki';
    this.serviceCenterModal.set(true);

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        pos => {
          const { latitude, longitude } = pos.coords;
          // Search all cities, pick nearest 3
          const all = getAllServiceCenters(make);
          const withDist = all
            .map(c => ({ ...c, distance: Math.round(haversineKm(latitude, longitude, c.lat, c.lng) * 10) / 10 }))
            // Reachable first, then nearest. Taking the nearest three
            // unconditionally is what put Hyderabad and Delhi in front of a
            // driver in Kolkata — the sort was right, the list just had
            // nothing else in it.
            .filter(c => (c.distance ?? Infinity) <= SERVICE_AREA_KM)
            .sort((a, b) => (a.distance ?? 999) - (b.distance ?? 999))
            .slice(0, 3);
          this.nearbyServiceCenters.set(withDist);
        },
        () => {
          // Geolocation denied — fall back to selected/default city
          const centers = getServiceCenters(make, this.city.selectedCity());
          this.nearbyServiceCenters.set(centers);
        },
      );
    } else {
      const centers = getServiceCenters(make, this.city.selectedCity());
      this.nearbyServiceCenters.set(centers);
    }
  }

  closeServiceModal() {
    this.serviceCenterModal.set(false);
    this.helpTab.set('mechanics');
  }

  callCenter(phone: string) {
    window.location.href = `tel:${phone.replace(/[^0-9]/g, '')}`;
  }

  directionsUrl(c: ServiceCenter): string {
    return `https://www.google.com/maps/dir/?api=1&destination=${c.lat},${c.lng}`;
  }

  formatCost(n: number): string {
    if (n >= 100000) return `₹${(n / 100000).toFixed(1)}L`;
    if (n >= 1000) return `₹${(n / 1000).toFixed(0)}K`;
    return `₹${n}`;
  }

  progressPct(): number {
    return Math.round((this.step() / this.totalSteps) * 100);
  }

  severityColor(s: string): string {
    return { low: '#10B981', medium: '#F59E0B', high: '#EF4444', critical: '#7C3AED' }[s] ?? '#6B7280';
  }

  // ── Voice Mode ────────────────────────────────────────────────────────────

  openVoiceMode() {
    this.inputMode.set('voice');
    this.showVoiceMode.set(true);
  }

  onVoiceCompleted(result: VoiceSessionResult) {
    this.showVoiceMode.set(false);
    this._voiceDetectedLang = result.detectedLanguage;

    const v = result.vehicleInfo as any;
    if (v.manufacturer) this.form.manufacturer = v.manufacturer;
    if (v.model) this.form.model = v.model;
    if (v.variant) this.form.variant = v.variant;
    if (v.model_year) this.form.model_year = String(v.model_year);
    if (v.fuel_type) this.form.fuel_type = v.fuel_type;
    if (v.transmission) this.form.transmission = v.transmission;
    if (v.odometer_km) this.form.odometer_km = v.odometer_km;

    if (result.problemDescription) {
      this.problemDescription = result.problemDescription;
    }

    // Jump to confirmation step if vehicle info is complete enough
    if (v.manufacturer && v.model && v.fuel_type && v.transmission) {
      this.step.set(3);
    } else {
      this.step.set(1);
    }
  }

  onVoiceCancelled() {
    // Backing out of voice mode means finishing by hand — don't then read
    // the report aloud unprompted.
    this.showVoiceMode.set(false);
    this.inputMode.set('manual');
  }

  // ── Voice input (Step 2 mic) ──────────────────────────────────────────────

  toggleVoice() {
    if (this.voice.state() === 'listening') {
      this.voice.stop();
    } else {
      this.voice.dismissError();
      this.voice.start((finalText: string) => {
        // Joined with a space. Plain concatenation ran the last word of one
        // utterance into the first of the next — "…not working properlymy
        // car…" — which is then what the model reads.
        const existing = this.problemDescription.trim();
        const addition = finalText.trim();
        if (!addition) return;
        this.problemDescription = (existing ? `${existing} ${addition}` : addition).slice(0, 2000);
      });
    }
  }

  selectVoiceLang(lang: VoiceLanguage) {
    this.voice.selectLanguage(lang);
    this.voiceLangOpen.set(false);
  }

  // ── Follow-up questions (BR-AI-10) ────────────────────────────────────────

  /** Read the follow-up questions aloud, in the user's language. */
  speakFollowUps() {
    const report = this.diagSvc.report() as any;
    const questions: string[] = report?.follow_up_questions ?? [];
    if (!questions.length) return;
    this.voice.speak(
      'To narrow this down, please tell me: ' + questions.join('. ')
    );
  }

  /**
   * Return to step 2 so the user can add the missing detail, with the
   * questions appended to the description as prompts to answer.
   */
  answerFollowUps() {
    const report = this.diagSvc.report() as any;
    const questions: string[] = report?.follow_up_questions ?? [];
    // Shown beside the box, NOT written into it.
    //
    // This used to append the questions to `problemDescription`, so the text
    // sent for diagnosis became the driver's symptoms plus our own questions.
    // Anyone who then pressed submit — or added a sentence by voice — had the
    // assistant's questions diagnosed as if they were symptoms, and the
    // pollution persisted for every later attempt.
    //
    // The description must stay what the driver said. Prompts belong in the
    // interface.
    this.followUpPrompts.set(questions);
    this.voice.stopSpeaking();
    this.diagSvc.report.set(null);
    this.step.set(2);
  }

  /** Re-run the diagnosis — used by the translation-failure banner. */
  async retryDiagnosis() {
    this.voice.stopSpeaking();
    await this.submit();
  }

  /**
   * Speak the current report on demand. Needed because the manual flow never
   * auto-plays, so the replay control has nothing buffered to replay.
   */
  playReport() {
    const report = this.diagSvc.report();
    if (!report) return;
    // An explicit tap on Listen overrides a stale mute preference; leaving it
    // muted would make the button appear broken.
    if (this.voice.muted()) this.voice.toggleMute();
    this.voice.speak(this._buildTtsText(report));
  }

  private _buildTtsText(report: any): string {
    const parts: string[] = [
      `Preliminary diagnosis: ${report.preliminary_diagnosis}`,
    ];
    if (report.safe_to_drive === false) {
      parts.push('Warning: Do not drive. Immediate professional inspection required.');
    }
    // The causes are the reasoning behind the headline, and they were on the
    // screen but not in the audio — so a driver listening hands-free heard
    // what the fault might be and nothing about why, which is most of what
    // makes the report worth anything.
    //
    // Confidence is spoken with each one, as it is shown. A cause read out
    // without it sounds like a finding rather than a possibility.
    //
    // Capped at three: the display shows three, and the server rejects a
    // synthesis request over 3000 characters (routers/diagnosis.py TtsRequest),
    // which a long list plus the steps could reach.
    if (report.possible_causes?.length) {
      const causes = report.possible_causes
        .slice(0, 3)
        .map((c: any) =>
          c.confidence == null ? `${c.cause}` : `${c.cause}, ${c.confidence} percent confidence`
        );
      parts.push('Possible causes: ' + causes.join('. '));
    }
    if (report.recommended_steps?.length) {
      parts.push('Recommended next steps: ' + report.recommended_steps.join('. '));
    }
    // Ask the follow-ups aloud too — a driver listening hands-free would
    // otherwise never learn the assessment was uncertain (BR-AI-10).
    if (report.needs_more_info && report.follow_up_questions?.length) {
      parts.push(
        'To be more certain, please tell me: ' + report.follow_up_questions.join('. ')
      );
    }
    return parts.join('. ');
  }

  ngOnDestroy() {
    this.voice.destroy();
  }

  /** Names of the closest telltale candidates, for the "not sure" case. */
  candidateNames(wl: { candidates?: { name: string }[] }): string {
    return (wl.candidates ?? []).map(c => c.name).join(', ');
  }

}
