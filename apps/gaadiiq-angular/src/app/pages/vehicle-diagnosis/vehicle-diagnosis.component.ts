import { Component, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { SeoService } from '../../services/seo.service';
import { DiagnosisService, DiagnoseRequest } from '../../services/diagnosis.service';
import { AuthService } from '../../services/auth.service';
import { SupabaseService } from '../../services/supabase.service';

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

const MAKES = [
  'Maruti Suzuki', 'Hyundai', 'Tata', 'Kia', 'MG', 'Toyota', 'Honda', 'Mahindra',
  'Skoda', 'Volkswagen', 'Renault', 'Nissan', 'Ford', 'Jeep', 'Isuzu', 'Other',
];

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

  step1Valid = computed(() =>
    !!this.form.manufacturer && !!this.form.model && !!this.form.fuel_type && !!this.form.transmission
  );

  step2Valid = computed(() => this.problemDescription.trim().length >= 10);

  constructor(
    private seo: SeoService,
    public diagSvc: DiagnosisService,
    private auth: AuthService,
    private sb: SupabaseService,
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
    window.location.href = '/test-drive';
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
