import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { IconComponent } from '../../components/icon/icon.component';
import { LenderMarkComponent } from '../../components/lender-mark/lender-mark.component';
import {
  CarLoanService,
  LendingPartner,
  LoanApplication,
  LoanOffer,
} from '../../services/car-loan.service';
import { AuthService } from '../../services/auth.service';
import { CustomSelectComponent, SelectOption } from '../../components/custom-select/custom-select.component';

@Component({
  selector: 'app-car-loan',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, IconComponent, LenderMarkComponent, CustomSelectComponent],
  templateUrl: './car-loan.component.html',
  styleUrl: './car-loan.component.scss',
})
export class CarLoanComponent implements OnInit {
  private readonly loans = inject(CarLoanService);
  private readonly auth = inject(AuthService);

  readonly partners = signal<LendingPartner[]>([]);
  readonly application = signal<LoanApplication | null>(null);
  readonly submitting = signal(false);
  readonly error = signal<string | null>(null);
  readonly selecting = signal<string | null>(null);

  readonly isSignedIn = computed(() => this.auth.currentUser() !== null);

  /**
   * The form. A plain object rather than signals because nothing recomputes
   * from it as it is typed — the derived figures below read the two fields that
   * do, and those are signals.
   */
  /** Stored values are what the API expects; the labels are for a human. */
  readonly employmentOptions: SelectOption[] = [
    { value: 'salaried', label: 'Salaried' },
    { value: 'self_employed', label: 'Self-employed professional' },
    { value: 'business', label: 'Business owner' },
  ];

  form = {
    vehicle_condition: 'new' as 'new' | 'used',
    vehicle_description: '',
    vehicle_year: null as number | null,
    applicant_name: '',
    mobile: '',
    email: '',
    city: '',
    pincode: '',
    pan_number: '',
    employment_type: 'salaried' as 'salaried' | 'self_employed' | 'business',
    employer_name: '',
    existing_emi: 0,
    credit_score: null as number | null,
    credit_consent: false,
  };

  // Signals, because the down-payment readout and the validity checks recompute
  // from them while the user drags the sliders.
  readonly vehiclePrice = signal(600000);
  readonly loanAmount = signal(500000);
  readonly tenureMonths = signal(60);
  readonly monthlyIncome = signal(50000);

  readonly downPayment = computed(() =>
    Math.max(0, this.vehiclePrice() - this.loanAmount()),
  );
  readonly downPaymentPct = computed(() => {
    const price = this.vehiclePrice();
    return price > 0 ? Math.round((this.downPayment() / price) * 100) : 0;
  });

  /** Cheapest eligible offer, which is the one carrying the recommendation. */
  readonly recommended = computed(() =>
    this.application()?.offers.find(o => o.is_recommended) ?? null,
  );
  readonly eligibleOffers = computed(() =>
    this.application()?.offers.filter(o => o.is_eligible) ?? [],
  );
  readonly ineligibleOffers = computed(() =>
    this.application()?.offers.filter(o => !o.is_eligible) ?? [],
  );

  // A method, not a computed(). computed() only tracks signal reads, and
  // `form.pan_number` is a plain field bound with ngModel — as a computed this
  // would evaluate once and then report the empty box's answer forever.
  panLooksValid(): boolean {
    return this.loans.isValidPan(this.form.pan_number);
  }

  async ngOnInit(): Promise<void> {
    try {
      this.partners.set(await this.loans.partners());
    } catch {
      // The rate table is a nicety; losing it must not block the form. The
      // application itself is what the page is for.
      this.partners.set([]);
    }
  }

  formatRupees(value: number | null | undefined): string {
    return this.loans.formatRupees(value);
  }

  /** Fields the server will reject anyway, checked here so the user is told sooner. */
  validationError(): string | null {
    if (!this.form.applicant_name.trim()) return 'Enter your full name as on your PAN card.';
    if (!/^\d{10}$/.test(this.form.mobile.trim())) return 'Enter a 10-digit mobile number.';
    if (!this.panLooksValid()) return 'Enter a valid PAN, in the format ABCDE1234F.';
    if (this.loanAmount() > this.vehiclePrice()) {
      return 'The loan cannot be more than the price of the car.';
    }
    if (this.monthlyIncome() <= 0) return 'Enter your monthly income.';
    return null;
  }

  async submit(): Promise<void> {
    const problem = this.validationError();
    if (problem) { this.error.set(problem); return; }

    this.error.set(null);
    this.submitting.set(true);
    try {
      const created = await this.loans.apply({
        vehicle_condition: this.form.vehicle_condition,
        vehicle_description: this.form.vehicle_description || undefined,
        vehicle_year: this.form.vehicle_year ?? undefined,
        vehicle_price: this.vehiclePrice(),
        applicant_name: this.form.applicant_name.trim(),
        mobile: this.form.mobile.trim(),
        email: this.form.email || undefined,
        city: this.form.city || undefined,
        pincode: this.form.pincode || undefined,
        pan_number: this.form.pan_number.toUpperCase().trim(),
        employment_type: this.form.employment_type,
        employer_name: this.form.employer_name || undefined,
        monthly_income: this.monthlyIncome(),
        existing_emi: this.form.existing_emi || 0,
        down_payment: this.downPayment(),
        loan_amount: this.loanAmount(),
        tenure_months: this.tenureMonths(),
        credit_score: this.form.credit_score,
        credit_consent: this.form.credit_consent,
      });
      this.application.set(created);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err: any) {
      this.error.set(
        err?.error?.detail ??
        (err?.status === 401
          ? 'Please sign in to apply — an application carries your PAN and income details.'
          : 'Could not submit the application. Please try again.'),
      );
    } finally {
      this.submitting.set(false);
    }
  }

  async choose(offer: LoanOffer): Promise<void> {
    const app = this.application();
    if (!app || !offer.is_eligible) return;
    this.selecting.set(offer.id);
    try {
      this.application.set(await this.loans.selectOffer(app.id, offer.id));
    } catch (err: any) {
      this.error.set(err?.error?.detail ?? 'Could not select that lender.');
    } finally {
      this.selecting.set(null);
    }
  }

  startOver(): void {
    this.application.set(null);
    this.error.set(null);
  }
}
