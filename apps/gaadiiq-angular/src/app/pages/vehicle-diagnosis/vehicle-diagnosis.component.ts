import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { SeoService } from '../../services/seo.service';
import { DiagnosisService, DiagnoseRequest } from '../../services/diagnosis.service';
import { AuthService } from '../../services/auth.service';
import { SupabaseService } from '../../services/supabase.service';
import { CityService } from '../../services/city.service';

interface ServiceCenter {
  name: string;
  address: string;
  phone: string;
  hours: string;
}

const SERVICE_CENTERS: Record<string, Record<string, ServiceCenter[]>> = {
  'Maruti Suzuki': {
    'Mumbai': [
      { name: 'Mandve Motors (Maruti Suzuki)', address: 'Plot No. 2, Sector 19A, Nerul, Navi Mumbai – 400706', phone: '022-27700200', hours: 'Mon–Sat 8am–7pm' },
      { name: 'Bimal Auto Agency', address: 'Dr. Annie Besant Road, Worli, Mumbai – 400018', phone: '022-24966200', hours: 'Mon–Sat 9am–6pm' },
    ],
    'Delhi': [
      { name: 'Competent Automobiles', address: 'A-1/2, Lawrence Road Industrial Area, Delhi – 110035', phone: '011-47060000', hours: 'Mon–Sat 8am–7pm' },
      { name: 'Rohan Motors', address: 'Plot 4, Pocket 2, Sector 22, Rohini, Delhi – 110086', phone: '011-27046789', hours: 'Mon–Sat 9am–6pm' },
    ],
    'Bangalore': [
      { name: 'Mandovi Motors', address: '3rd Cross, Sadashivanagar, Bangalore – 560080', phone: '080-23610101', hours: 'Mon–Sat 8am–7pm' },
      { name: 'Indus Motors', address: 'Outer Ring Road, Marathahalli, Bangalore – 560037', phone: '080-25230101', hours: 'Mon–Sat 9am–6pm' },
    ],
    'Hyderabad': [
      { name: 'Popular Maruti', address: '6-3-354/1, Rd No. 1, Banjara Hills, Hyderabad – 500034', phone: '040-23559900', hours: 'Mon–Sat 8am–7pm' },
    ],
    'Chennai': [
      { name: 'Akshaya Automobiles', address: '7, Arcot Road, Vadapalani, Chennai – 600026', phone: '044-43101010', hours: 'Mon–Sat 8am–7pm' },
    ],
    'Pune': [
      { name: 'Navnit Motors', address: 'Survey No. 28, Nagar Road, Viman Nagar, Pune – 411014', phone: '020-66013333', hours: 'Mon–Sat 8am–7pm' },
    ],
    'New Town': [
      { name: 'Mandve Motors Kolkata', address: 'AA-1, Sector II, Salt Lake, Kolkata – 700091', phone: '033-23589900', hours: 'Mon–Sat 8am–7pm' },
    ],
  },
  'Hyundai': {
    'Mumbai': [
      { name: 'Solitaire Hyundai', address: 'Plot 31, MIDC, Andheri East, Mumbai – 400093', phone: '022-42006700', hours: 'Mon–Sat 8am–7pm' },
    ],
    'Delhi': [
      { name: 'Kggs Hyundai', address: '1103, Main Mathura Road, Badarpur, New Delhi – 110044', phone: '011-29946000', hours: 'Mon–Sat 9am–6pm' },
    ],
    'Bangalore': [
      { name: 'Trident Hyundai', address: 'No. 1, Hosur Road, Bommanahalli, Bangalore – 560068', phone: '080-49000000', hours: 'Mon–Sat 8am–7pm' },
    ],
    'Hyderabad': [
      { name: 'VW Hyundai', address: 'Plot 7, Ameerpet, Hyderabad – 500016', phone: '040-66360000', hours: 'Mon–Sat 8am–7pm' },
    ],
    'Chennai': [
      { name: 'Kun Hyundai', address: 'No. 1, GST Road, Chromepet, Chennai – 600044', phone: '044-22380000', hours: 'Mon–Sat 8am–7pm' },
    ],
    'Pune': [
      { name: 'Dhoot Hyundai', address: 'Survey No. 98, Nagar Road, Wagholi, Pune – 412207', phone: '020-27050000', hours: 'Mon–Sat 8am–7pm' },
    ],
  },
  'Tata': {
    'Mumbai': [
      { name: 'Tata Motors Service Centre', address: 'Plot 46, TTC Industrial Area, Navi Mumbai – 400710', phone: '022-27694000', hours: 'Mon–Sat 8am–7pm' },
    ],
    'Delhi': [
      { name: 'Concorde Motors', address: 'A-24, Mohan Co-operative Industrial Estate, New Delhi – 110044', phone: '011-41625555', hours: 'Mon–Sat 9am–6pm' },
    ],
    'Bangalore': [
      { name: 'Prerana Motors', address: 'No. 6, Residency Road, Bangalore – 560025', phone: '080-22117777', hours: 'Mon–Sat 8am–7pm' },
    ],
    'Hyderabad': [
      { name: 'Concorde Motors Hyderabad', address: '6-3-571, Rockdale Compound, Somajiguda, Hyderabad – 500082', phone: '040-23399999', hours: 'Mon–Sat 8am–7pm' },
    ],
    'Chennai': [
      { name: 'Tata Motors Works', address: 'No. 48, Mount Road, Chennai – 600002', phone: '044-28521234', hours: 'Mon–Sat 8am–7pm' },
    ],
    'Pune': [
      { name: 'Tata Motors Authorized Service', address: 'Plot 4, Hadapsar Industrial Estate, Pune – 411013', phone: '020-26871234', hours: 'Mon–Sat 8am–7pm' },
    ],
  },
};

function getServiceCenters(manufacturer: string, city: string): ServiceCenter[] {
  const byMake = SERVICE_CENTERS[manufacturer] ?? SERVICE_CENTERS['Maruti Suzuki'];
  return byMake[city] ?? byMake[Object.keys(byMake)[0]] ?? [];
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
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './vehicle-diagnosis.component.html',
  styleUrl: './vehicle-diagnosis.component.scss',
})
export class VehicleDiagnosisComponent {
  step = signal(1);
  totalSteps = 4;

  // Step 1 — Vehicle details
  form = {
    manufacturer: '', model: '', variant: '', model_year: new Date().getFullYear() - 2,
    fuel_type: '', transmission: '', odometer_km: null as number | null,
  };

  // Step 2 — Symptoms
  problemDescription = '';
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

  years = Array.from({ length: 35 }, (_, i) => new Date().getFullYear() - i);

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

  serviceCenterModal = signal(false);
  nearbyServiceCenters = signal<ServiceCenter[]>([]);

  constructor(
    private seo: SeoService,
    public diagSvc: DiagnosisService,
    private auth: AuthService,
    private sb: SupabaseService,
    public city: CityService,
  ) {
    seo.setPage(
      'AI Vehicle Diagnosis',
      'Describe your car problem and get an instant AI-powered preliminary diagnosis with repair cost estimates.',
    );
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

    const request: DiagnoseRequest = {
      manufacturer: this.form.manufacturer,
      model: this.form.model,
      variant: this.form.variant || undefined,
      model_year: this.form.model_year,
      fuel_type: this.form.fuel_type,
      transmission: this.form.transmission,
      odometer_km: this.form.odometer_km ?? undefined,
      problem_description: this.problemDescription,
      warning_lights: this.selectedWarningLights(),
      when_occurs: this.selectedWhenOccurs(),
      severity: this.severity,
      user_id: userId,
    };

    this.step.set(4);
    await this.diagSvc.analyse(request);
  }

  reset() {
    this.step.set(1);
    this.form = { manufacturer: '', model: '', variant: '', model_year: new Date().getFullYear() - 2, fuel_type: '', transmission: '', odometer_km: null };
    this.problemDescription = '';
    this.selectedWarningLights.set([]);
    this.selectedWhenOccurs.set([]);
    this.severity = 'medium';
    this.diagSvc.report.set(null);
    this.diagSvc.error.set(null);
  }

  bookService() {
    const centers = getServiceCenters(
      this.form.manufacturer || 'Maruti Suzuki',
      this.city.selectedCity() || 'Mumbai',
    );
    this.nearbyServiceCenters.set(centers);
    this.serviceCenterModal.set(true);
  }

  closeServiceModal() {
    this.serviceCenterModal.set(false);
  }

  callCenter(phone: string) {
    window.location.href = `tel:${phone.replace(/[^0-9]/g, '')}`;
  }

  directionsUrl(address: string): string {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
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
}
