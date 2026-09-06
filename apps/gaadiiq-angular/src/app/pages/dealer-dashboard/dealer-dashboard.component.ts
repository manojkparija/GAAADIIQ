import { Component, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { SeoService } from '../../services/seo.service';
import { CarsDataService } from '../../services/cars-data.service';
import {
  TestDriveService, TestDriveRequest,
  TEST_DRIVE_STATUSES, TEST_DRIVE_OUTCOMES,
} from '../../services/test-drive.service';
import { AuthService } from '../../services/auth.service';
import { SellersService, Seller } from '../../services/sellers.service';
import { SupabaseService } from '../../services/supabase.service';
import { SentimentService, Lead, IntentScore, LeadGrade } from '../../services/sentiment.service';
import { DealerCarImagesService } from '../../services/dealer-car-images.service';
import { MyListingsService } from '../../services/my-listings.service';
import { IconComponent } from '../../components/icon/icon.component';
import { CustomSelectComponent } from '../../components/custom-select/custom-select.component';
import { FormsModule } from '@angular/forms';
import { NativeService, NativePhoto } from '../../services/native.service';
import { LeadService, CarLead, LeadStatus, LEAD_STATUSES } from '../../services/lead.service';
import { TranslatePipe } from '../../pipes/translate.pipe';

interface CarEnquiry {
  id: string; car_id: string; buyer_name: string; buyer_phone: string;
  buyer_email: string | null; notes: string | null; created_at: string;
}

interface DealerMetric { label: string; value: string; change: string; up: boolean; icon: string; }
interface LeadRow {
  name: string; car: string; budget: string; stage: string; stageColor: string; time: string;
  intentScore: number; leadGrade: 'A' | 'B' | 'C' | 'D';
  bestContactTime: string; nba: string; phone: string;
}

@Component({
  selector: 'app-dealer-dashboard',
  standalone: true,
  imports: [CommonModule, RouterLink, IconComponent, CustomSelectComponent, FormsModule, TranslatePipe],
  templateUrl: './dealer-dashboard.component.html',
  styleUrl: './dealer-dashboard.component.scss',
})
export class DealerDashboardComponent {
  metrics: DealerMetric[] = [
    { label: 'Total Listings', value: '24', change: '+3 this week', up: true, icon: '🚗' },
    { label: 'Profile Views', value: '1,248', change: '+18% vs last week', up: true, icon: '👁️' },
    { label: 'Enquiries', value: '87', change: '+12 today', up: true, icon: '💬' },
    { label: 'Test Drive Requests', value: '—', change: 'Loading…', up: true, icon: '🗝️' },
    { label: 'Avg. Days to Sell', value: '18', change: '−3 days improved', up: true, icon: '📅' },
    { label: 'Revenue (MTD)', value: '₹14.2L', change: '+24% vs last month', up: true, icon: '💰' },
  ];

  leads: LeadRow[] = [
    { name: 'Arjun Mehta', car: 'Maruti Swift 2024', budget: '₹7–9L', stage: 'Hot Lead', stageColor: 'red', time: '2 min ago', intentScore: 92, leadGrade: 'A', bestContactTime: 'Now · 10am–1pm', nba: 'Schedule Test Drive', phone: '+91 98765 43210' },
    { name: 'Priya Nair', car: 'Hyundai Creta 2023', budget: '₹12–15L', stage: 'Test Drive', stageColor: 'purple', time: '18 min ago', intentScore: 85, leadGrade: 'A', bestContactTime: 'Eve · 6–8pm', nba: 'Send Finance Offer', phone: '+91 98745 12340' },
    { name: 'Ravi Kumar', car: 'Tata Nexon EV', budget: '₹14–18L', stage: 'Negotiation', stageColor: 'gold', time: '1 hr ago', intentScore: 78, leadGrade: 'B', bestContactTime: 'Morn · 9–11am', nba: 'Share Subsidy Details', phone: '+91 97865 43201' },
    { name: 'Sneha Joshi', car: 'Maruti Alto K10', budget: '₹4–5L', stage: 'New Enquiry', stageColor: 'blue', time: '2 hr ago', intentScore: 61, leadGrade: 'B', bestContactTime: 'Noon · 12–2pm', nba: 'Send Brochure', phone: '+91 96754 32109' },
    { name: 'Deepak Rao', car: 'Mahindra Scorpio-N', budget: '₹18–22L', stage: 'Documentation', stageColor: 'green', time: '3 hr ago', intentScore: 95, leadGrade: 'A', bestContactTime: 'Morn · 10am', nba: 'Collect Documents', phone: '+91 95643 21098' },
    { name: 'Lalita Sharma', car: 'Toyota Innova HyCross', budget: '₹20–25L', stage: 'Hot Lead', stageColor: 'red', time: '4 hr ago', intentScore: 44, leadGrade: 'C', bestContactTime: 'Eve · 7–9pm', nba: 'Re-engage via WhatsApp', phone: '+91 94532 10987' },
  ];

  fuelMix = [
    { label: 'Petrol', pct: 42, color: '#2F6BFF' },
    { label: 'Diesel', pct: 28, color: '#EF4444' },
    { label: 'Electric', pct: 18, color: '#43E97B' },
    { label: 'CNG', pct: 8, color: '#FFD700' },
    { label: 'Hybrid', pct: 4, color: '#60A5FA' },
  ];

  topModels = [
    { model: 'Maruti Swift', views: 312, enquiries: 24 },
    { model: 'Hyundai Creta', views: 278, enquiries: 19 },
    { model: 'Tata Nexon EV', views: 241, enquiries: 16 },
    { model: 'Mahindra Scorpio-N', views: 198, enquiries: 11 },
    { model: 'Maruti Alto K10', views: 176, enquiries: 9 },
  ];

  activeTab = signal<'overview' | 'leads' | 'inventory' | 'analytics' | 'test-drives' | 'enquiries' | 'car-leads'>('overview');

  // ── New-car leads ────────────────────────────────────────────────────────
  readonly leadStatuses = LEAD_STATUSES;
  carLeads     = signal<CarLead[]>([]);
  leadsLoading = signal(false);
  /**
   * Held rather than swallowed. A failed fetch and an empty inbox look
   * identical on screen otherwise, and one of them means buyers are waiting
   * for a call nobody knows to make.
   */
  leadsError    = signal<string | null>(null);
  savingLeadId  = signal<string | null>(null);

  /** Unworked leads — what the tab badge counts. */
  newLeads = computed(() => this.carLeads().filter(l => l.status === 'new'));

  // ── Sentiment / AI Leads ────────────────────────────────────────────────
  sentimentLeads = this.sentimentSvc.leads;
  sentimentSummary = this.sentimentSvc.summary;
  sentimentLoading = this.sentimentSvc.loading;
  analysingId = this.sentimentSvc.analysingId;
  selectedLead = signal<IntentScore | null>(null);
  gradeFilter = signal<LeadGrade | null>(null);

  filteredLeads = computed(() => {
    const f = this.gradeFilter();
    return f ? this.sentimentLeads().filter(l => l.lead_grade === f) : this.sentimentLeads();
  });

  hotLeadCount = computed(() => this.sentimentLeads().filter(l => l.intent_score >= 80).length);
  topLead = computed(() => this.sentimentLeads()[0] ?? null);

  enquiries = signal<CarEnquiry[]>([]);
  enquiriesLoading = signal(false);
  /**
   * Why the enquiries list is empty, when it is empty for a reason.
   *
   * A refused read and "no enquiries yet" render identically as an empty
   * list, and that is precisely how a table with row-level security enabled
   * and no SELECT policy went unnoticed.
   */
  enquiriesError = signal('');

  testDriveRequests = this.testDriveSvc.requests;
  testDriveCount = computed(() => this.testDriveRequests().length);
  pendingTestDrives = computed(() => this.testDriveRequests().filter(r => r.status === 'Pending'));

  // Plain arrays, not computed(): the option lists never change.
  readonly testDriveStatuses = [...TEST_DRIVE_STATUSES];
  readonly testDriveOutcomes = [...TEST_DRIVE_OUTCOMES];

  /** Row currently being written, and the row whose last write failed. */
  savingTestDrive = signal<number | null>(null);
  testDriveError = signal<number | null>(null);

  /**
   * How many completed drives turned into a sale.
   *
   * Over completed drives, not over all requests — a request still pending is
   * not a lost deal, and counting it as one would make every dealer's rate
   * look worse the more bookings they take. Null until there is something to
   * divide by, so the card says "no completed drives yet" rather than 0%.
   */
  testDriveConversion = computed(() => {
    const completed = this.testDriveRequests().filter(r => r.status === 'Completed');
    if (!completed.length) return null;
    const won = completed.filter(r => r.outcome === 'Won').length;
    return { won, completed: completed.length, pct: Math.round((won / completed.length) * 100) };
  });

  async setTestDriveStatus(r: TestDriveRequest, status: string) {
    if (!r.id || status === r.status) return;
    await this.writeTestDrive(r, { status });
  }

  async setTestDriveOutcome(r: TestDriveRequest, outcome: string) {
    if (!r.id || outcome === (r.outcome ?? '')) return;
    await this.writeTestDrive(r, { outcome: outcome || null });
  }

  private async writeTestDrive(
    r: TestDriveRequest,
    changes: { status?: string; outcome?: string | null },
  ) {
    this.savingTestDrive.set(r.id!);
    this.testDriveError.set(null);
    const ok = await this.testDriveSvc.update(r.id!, changes);
    this.savingTestDrive.set(null);
    // Surfaced rather than swallowed: row-level security refuses a write by
    // returning no rows, not by raising, so a silent failure here would look
    // exactly like a successful save until the page was reloaded.
    if (!ok) this.testDriveError.set(r.id!);
  }

  currentSeller = signal<Seller | null>(null);
  authUser = computed(() => this.auth.currentUser());

  /** For the template — `auth` itself stays private. */
  isAdmin = computed(() => this.auth.isAdmin());

  // ── The dealer's own car photographs ───────────────────────────────────
  //
  // Their listings, and the pictures on one of them. Not the shared catalogue:
  // vehicle_media is matched on make + model + year and shows on every car of
  // that model, so a dealer writing there would put their photo on a
  // competitor's listing.
  listingsLoading = this.myListingsSvc.loading;
  myCars = computed(() => this.myListingsSvc.listings().filter(l => l.supabaseId != null));

  myCarOptions = computed(() => this.myCars().map(l => ({
    value: l.supabaseId!,
    label: `${l.year} ${l.make} ${l.model}${l.variant ? ' ' + l.variant : ''}`,
  })));

  selectedCarId = signal<string | null>(null);
  carImages = this.dealerImages.images;
  carImagesLoading = this.dealerImages.loading;
  carImagesError = this.dealerImages.error;

  selectCar(id: string) {
    // No Number() here: cars.id is a uuid, and coercing it gives NaN.
    const carId = id || null;
    this.selectedCarId.set(carId);
    if (carId) void this.dealerImages.load(carId);
  }

  async onDealerImagePick(event: Event) {
    const input = event.target as HTMLInputElement;
    const carId = this.selectedCarId();
    if (!input.files?.length || !carId) return;

    // Capped at ten, matching the List Your Car form. Buyers stop scrolling
    // long before that, and every extra file is bandwidth on a phone.
    const files = Array.from(input.files).slice(0, 10);
    await this.dealerImages.add(carId, files);

    // Cleared so choosing the same file twice still fires a change event.
    input.value = '';
  }

  /** True in the Android/iOS shell, where the camera is worth offering. */
  get isNativeApp(): boolean { return this.native.isNative; }

  /**
   * Photograph a car in the yard, rather than hunting for it in a file browser.
   *
   * Same reasoning as List Your Car: a dealer adding photos is standing next to
   * the stock. Goes through DealerCarImagesService like the file path, so the
   * review workflow, the pending status and the RLS ownership check all still
   * apply — the camera changes where the bytes come from, nothing else.
   */
  async addDealerPhoto(source: 'camera' | 'gallery'): Promise<void> {
    const carId = this.selectedCarId();
    if (!carId || this.carImagesLoading()) return;

    let photo: NativePhoto | null;
    try {
      photo = source === 'camera'
        ? await this.native.takePhoto()
        : await this.native.pickPhoto();
    } catch {
      return;                       // cancelled — not a failure
    }
    if (!photo) return;

    const file = NativeService.photoToFile(photo, `car-${carId}`);
    if (!file) return;

    const ok = await this.dealerImages.add(carId, [file]);
    // add() reports refusal by returning false — row-level security declines a
    // write with no rows and no error — so the buzz follows the result, not the
    // fact that the call returned.
    if (ok) this.native.tap('light'); else this.native.buzzError();
  }

  async removeDealerImage(imageId: number) {
    await this.dealerImages.remove(imageId);
  }
  /*
   * Both of these guard the object AND the field, and the second half is the
   * part that was missing.
   *
   * `Seller.business_name` and `AuthUser.name` are both typed as plain strings,
   * so TypeScript is satisfied — but they arrive from Supabase at runtime,
   * where a column that is nullable in the database says nothing to the
   * compiler. One NULL and `.split` throws.
   *
   * Throwing HERE is worse than throwing almost anywhere else: this is inside a
   * computed(), which Angular re-evaluates on change detection, so a single bad
   * row does not produce one error — it produces one per cycle, and the page
   * degrades rather than showing the '??' this function already had ready.
   * Observed while building e2e coverage: a seller record with no
   * business_name filled the console with "Cannot read properties of undefined
   * (reading 'split')" and kept going.
   */
  sellerInitials = computed(() => this.initials(this.currentSeller()?.business_name, '??'));
  authInitials = computed(() => this.initials(this.auth.currentUser()?.name, '?'));


  constructor(seo: SeoService, private testDriveSvc: TestDriveService,
              private auth: AuthService, private sellersSvc: SellersService,
              private sb: SupabaseService, public sentimentSvc: SentimentService,
              private dealerImages: DealerCarImagesService,
              private myListingsSvc: MyListingsService,
              private native: NativeService,
              private leadSvc: LeadService) {
    seo.setPage('Dealer Dashboard', 'Dealer intelligence dashboard — listings, leads, analytics.');
    this.loadSellerInfo();
    this.sentimentSvc.loadLeads();
    this.sentimentSvc.loadSummary();
  }

  /** Retry the sentiment panel after a failure, from the dashboard's own button. */
  reloadSentiment() {
    this.sentimentSvc.loadLeads();
    this.sentimentSvc.loadSummary();
  }

  private async loadSellerInfo() {
    const user = this.auth.currentUser();
    if (!user) return;

    let seller: Seller | null = null;
    if (user.sellerId) {
      seller = await this.sellersSvc.getById(user.sellerId);
    } else if (user.email) {
      seller = await this.sellersSvc.getByEmail(user.email);
    }
    this.currentSeller.set(seller);

    // Load test drives filtered to this seller
    const sellerId = seller?.id ?? user.sellerId;
    this.testDriveSvc.loadForSeller(sellerId ?? null, this.auth.isAdmin());

    // Load buyer enquiries for this seller's car listings
    this.loadEnquiries();
    this.loadLeads();
  }

  private async loadLeads(): Promise<void> {
    this.leadsLoading.set(true);
    this.leadsError.set(null);
    try {
      this.carLeads.set(await this.leadSvc.list());
    } catch (e: any) {
      // 403 is a real answer, not a fault: the account is not a dealer. Saying
      // so beats "could not load", which sends someone hunting a bug.
      this.leadsError.set(
        e?.status === 403
          ? 'This account is not registered as a dealer, so it has no lead inbox.'
          : 'Could not load your leads. Refresh to try again.',
      );
    } finally {
      this.leadsLoading.set(false);
    }
  }

  async setLeadStatus(lead: CarLead, status: LeadStatus): Promise<void> {
    if (lead.status === status) return;
    const previous = lead.status;
    this.savingLeadId.set(lead.id);
    // Optimistic, then rolled back on failure: a status that silently reverts
    // on the next load is how a dealer loses track of who they have called.
    this.carLeads.update(rows =>
      rows.map(r => (r.id === lead.id ? { ...r, status } : r)),
    );
    try {
      await this.leadSvc.setStatus(lead.id, status);
    } catch {
      this.carLeads.update(rows =>
        rows.map(r => (r.id === lead.id ? { ...r, status: previous } : r)),
      );
      this.leadsError.set('Could not save that status. It has been put back.');
    } finally {
      this.savingLeadId.set(null);
    }
  }

  /**
   * The enquiries this account is allowed to see.
   *
   * Scoped by row-level security (024), not here. This method used to filter
   * client-side for non-admins by first fetching that seller's rows from
   * `car_listings` — a table that does not exist in the database. The query
   * returned null, `ids` came out empty, and the method returned an empty list
   * before it ever asked about enquiries. So a dealer's Enquiries tab was
   * always empty, whatever was in the table.
   *
   * Removing the filter rather than repairing it is deliberate, and it is the
   * same move 010_test_drive_outcome.sql made for test drives: a filter
   * applied in TypeScript is advisory, because the anon key ships in the
   * browser bundle and anyone holding it can ask for the unfiltered rows.
   * Enquiries carry a buyer's name, phone number and email. The database is
   * the only place that rule can actually be enforced, and now it is: a seller
   * sees enquiries naming their own listings, an admin sees all, and everyone
   * else sees nothing.
   *
   * An error is surfaced rather than swallowed. `{ data }` alone turns a
   * refused read into an empty list, which looks exactly like "no enquiries
   * yet" — and that indistinguishability is what let this sit unnoticed.
   */
  private async loadEnquiries() {
    this.enquiriesLoading.set(true);
    try {
      const { data, error } = await this.sb.client
        .from('car_enquiries')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Could not load enquiries:', error);
        this.enquiriesError.set(
          `Could not load enquiries: ${error.message ?? 'unknown error'}`,
        );
        this.enquiries.set([]);
        return;
      }

      this.enquiriesError.set('');
      this.enquiries.set((data ?? []) as CarEnquiry[]);
    } finally {
      this.enquiriesLoading.set(false);
    }
  }

  timeAgo(dateStr: string): string {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins} min ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs} hr ago`;
    return `${Math.floor(hrs / 24)} days ago`;
  }

  countGrade(grade: 'A' | 'B' | 'C' | 'D') {
    return this.leads.filter(l => l.leadGrade === grade).length;
  }

  // Sentiment helpers
  async reanalyse(lead: Lead) {
    const result = await this.sentimentSvc.analyseCustomer(lead.user_id, lead.customer_name);
    if (result) this.selectedLead.set(result);
  }

  setGradeFilter(grade: LeadGrade | null) { this.gradeFilter.set(grade); }

  gradeLabel(grade: LeadGrade): string {
    return { A: 'Act Now', B: 'Follow Up', C: 'Nurture', D: 'Re-engage' }[grade];
  }

  scoreBar(score: number): string {
    if (score >= 80) return 'var(--danger, #EF4444)';
    if (score >= 60) return '#F59E0B';
    if (score >= 40) return '#3B82F6';
    return 'var(--muted)';
  }

  /**
   * Initials from a name that may not be there.
   *
   * The template calls this directly for lead and enquiry rows, where the name
   * is genuinely optional — a buyer can leave it blank, and the lead table
   * already renders "Not given" for that case. This used to take `name: string`
   * and split it unguarded, so the one place the data model says is optional
   * was the one place that could not survive it.
   *
   * Also filters empty segments: "  R   Kumar  " has words that are the empty
   * string, and w[0] on those is undefined, which join() renders as "undefined".
   */
  initials(name: string | null | undefined, fallback = '?'): string {
    const words = (name ?? '').split(' ').filter(Boolean);
    if (!words.length) return fallback;
    return words.map(w => w[0]).join('').slice(0, 2).toUpperCase();
  }

  timeAgoFromDate(d: string | null): string {
    if (!d) return '—';
    return this.timeAgo(d);
  }

  waLink(phone: string | null | undefined): string {
    if (!phone) return '#';
    return 'https://wa.me/' + phone.replace(/\D/g, '');
  }
}
