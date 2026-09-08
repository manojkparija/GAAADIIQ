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
  /**
   * Where this enquiry has got to. Same five values car_leads uses, so the
   * two inboxes read the same way (025).
   *
   * Optional because a row written before 025 has no status until the column
   * default fills it in, and a dashboard that renders `undefined` in a select
   * is worse than one that shows 'new'.
   */
  status?: LeadStatus;
  /** The dealer this lead was handed to, if any (027). */
  assigned_seller_id?: number | null;
  assigned_to_dealer_at?: string | null;
}

interface DealerMetric { label: string; value: string; change: string; up: boolean; icon: string; }

@Component({
  selector: 'app-dealer-dashboard',
  standalone: true,
  imports: [CommonModule, RouterLink, IconComponent, CustomSelectComponent, FormsModule, TranslatePipe],
  templateUrl: './dealer-dashboard.component.html',
  styleUrl: './dealer-dashboard.component.scss',
})
export class DealerDashboardComponent {
  /**
   * The headline cards, counted from this dealer's own data.
   *
   * WHAT WAS HERE
   *
   * Six fixed cards, assigned once and never touched again — grep for
   * `metrics` and the declaration was the only hit:
   *
   *   Total Listings 24 · Profile Views 1,248 · Enquiries 87 ·
   *   Test Drive Requests "—" / "Loading…" · Avg. Days to Sell 18 ·
   *   Revenue (MTD) ₹14.2L "+24% vs last month"
   *
   * They sat on the Overview while the tabs beside them read Test Drives 1
   * and Enquiries 2, so the page contradicted itself on screen. The fourth
   * card is its own small tell: it said "Loading…" permanently, because
   * nothing ever loaded it.
   *
   * WHAT IS COUNTED NOW, AND WHAT IS GONE
   *
   * Three of the six have a real source and are counted here. The other
   * three are removed rather than approximated, because nothing in this
   * system records them:
   *
   *   - Profile views. No per-dealer view counter exists anywhere.
   *   - Avg. days to sell. A listing has createdAt and a status, but no
   *     sold-at timestamp, so the interval cannot be computed even in
   *     principle.
   *   - Revenue. The dealer's own sales are not in this database at all.
   *     "₹14.2L, +24% vs last month" is the most believable number on the
   *     page and the one with the least behind it.
   */
  metrics = computed<DealerMetric[]>(() => {
    const DAY = 86_400_000;
    const now = Date.now();
    const withinWeek = (iso?: string | null) =>
      !!iso && now - new Date(iso).getTime() <= 7 * DAY;

    const cars = this.myCars();
    const enquiries = this.enquiries();
    const drives = this.testDriveRequests();

    const newCars = cars.filter(c => withinWeek(c.createdAt)).length;
    const newEnquiries = enquiries.filter(e => withinWeek(e.created_at)).length;
    const pendingDrives = drives.filter(r => (r.status ?? 'Pending') === 'Pending').length;

    return [
      {
        label: 'Live Listings', value: String(cars.length), icon: '🚗', up: true,
        change: newCars ? `+${newCars} this week` : 'none added this week',
      },
      {
        label: 'Enquiries', value: String(enquiries.length), icon: '💬', up: true,
        change: newEnquiries ? `+${newEnquiries} this week` : 'none this week',
      },
      {
        label: 'Test Drive Requests', value: String(drives.length), icon: '🗝️', up: true,
        change: pendingDrives ? `${pendingDrives} awaiting a date` : 'none awaiting a date',
      },
    ];
  });

  /**
   * The four most recent enquiries, for the Overview preview.
   *
   * This table used to render `leads.slice(0, 4)` — six invented buyers,
   * each with a name, a budget band, an intent score and a DIALABLE PHONE
   * NUMBER (Arjun Mehta +91 98765 43210 and five more). The same shape as
   * the fabricated dealer removed in #235, and a dealer could have rung one.
   *
   * The columns that survive are the ones a real enquiry can fill. Budget
   * and lead grade are not among them: a buyer enquiry carries no budget,
   * and a grade is the sentiment service's to assign, not this table's to
   * invent.
   */
  recentEnquiries = computed(() =>
    [...this.enquiries()]
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 4)
      .map(e => ({
        id: e.id,
        name: e.buyer_name,
        car: this.carLabel(e.car_id),
        status: e.status ?? 'new',
        when: this.timeAgo(e.created_at),
      })),
  );

  /**
   * Which of this dealer's cars buyers are actually asking about.
   *
   * Was `topModels`: five models with view counts (312, 278, 241…) and
   * conversion rates computed from them. Nothing records listing views, so
   * both columns and the rate derived from them were invented.
   *
   * Enquiries per model IS recorded, so that is what this counts. A model
   * nobody has asked about does not appear, and with no enquiries at all
   * the panel does not render.
   */
  enquiredModels = computed(() => {
    const counts = new Map<string, number>();
    for (const e of this.enquiries()) {
      const label = this.carLabel(e.car_id);
      if (label === '—') continue;
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([model, enquiries]) => ({ model, enquiries }))
      .sort((a, b) => b.enquiries - a.enquiries)
      .slice(0, 5);
  });

  /**
   * A car_id as something a dealer recognises.
   *
   * car_enquiries.car_id holds two kinds of uuid — a listings.id from
   * mapListing, or a cars.id from mapCatalogueCar — and the column cannot
   * tell them apart. Only the first can be matched against this dealer's
   * own stock; an enquiry against catalogue stock is a lead for the
   * business rather than for them, and says "—" rather than guessing.
   */
  carLabel(carId: string): string {
    const hit = this.myCars().find(c => c.supabaseId === carId);
    return hit ? `${hit.make} ${hit.model}`.trim() : '—';
  }


  /**
   * The colour each fuel is drawn in. The percentages are computed from the
   * dealer's own listings — see fuelMix() below.
   */
  private readonly FUEL_COLOURS: Record<string, string> = {
    Petrol: '#2F6BFF',
    Diesel: '#EF4444',
    Electric: '#43E97B',
    CNG: '#FFD700',
    Hybrid: '#60A5FA',
  };

  /**
   * What this dealer actually has on the forecourt, by fuel.
   *
   * This was a fixed list — Petrol 42%, Diesel 28%, Electric 18%, CNG 8%,
   * Hybrid 4% — shown under the heading "Fuel Mix Breakdown" on a page
   * subtitled "Real-time insights into your listings". It was the same five
   * numbers for every dealer on every day, including a dealer with no
   * listings at all.
   *
   * Now counted from myCars(). Anything the colour map does not name still
   * appears, so a fuel nobody anticipated is shown rather than dropped.
   */
  fuelMix = computed(() => {
    const cars = this.myCars();
    if (!cars.length) return [];

    const counts = new Map<string, number>();
    for (const c of cars) {
      const label = (c.fuel || '').trim() || 'Not stated';
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }

    return [...counts.entries()]
      .map(([label, n]) => ({
        label,
        pct: Math.round((n / cars.length) * 100),
        count: n,
        color: this.FUEL_COLOURS[label] ?? '#94A3B8',
      }))
      .sort((a, b) => b.pct - a.pct);
  });

  /**
   * Market Intelligence, computed from this dealer's own data.
   *
   * WHAT WAS THERE BEFORE
   *
   * Four cards of fixed prose, identical for every dealer on every day, under
   * a heading on a page that promises "real-time insights":
   *
   *   "SUVs in Bangalore are trending 4.2% above national average this week."
   *   "Electric vehicle searches up 34% in your city."
   *   "Your response time (avg 22 min) is in the top 15% of dealers."
   *   "Listings posted Thursday-Friday see 28% more views over the weekend."
   *
   * Reported as static, which it was. But the deeper problem is that two of
   * them are claims about the reader: a response time nobody measured, and a
   * ranking against a peer group that has four members. A dealer in Rourkela
   * was being told what SUVs do in Bangalore. This is the same rule the rest
   * of the codebase already follows — credit_bureau.fetch_score raises rather
   * than returning a plausible number, and the car page now says "Price not
   * announced yet" rather than ₹0.
   *
   * WHAT REPLACED THEM, AND WHAT DID NOT
   *
   * Every card below is derived from data this dashboard already holds, and a
   * card that cannot be computed is not rendered at all rather than filled in
   * with something reasonable-sounding. Two of the originals have no honest
   * version and are simply gone:
   *
   *   - Response time. Nothing records when a dealer first replied to an
   *     enquiry; there is no such column. It could be built (stamp a
   *     first_responded_at when status leaves 'new') but it cannot be
   *     back-computed, and a made-up 22 minutes is worse than no card.
   *   - Best time to list. Needs views bucketed by weekday. Listing views are
   *     not recorded per day anywhere.
   */
  marketIntel = computed<{ icon: string; title: string; detail: string }[]>(() => {
    const cards: { icon: string; title: string; detail: string }[] = [];
    const cars = this.myCars();
    const enquiries = this.enquiries();
    const now = Date.now();
    const DAY = 86_400_000;

    // 1. Demand on this dealer's cars, this month against last.
    //
    // The honest version of "EV Demand Surge": a count of enquiries actually
    // received, not a search statistic nobody collects.
    if (enquiries.length) {
      const age = (e: { created_at: string }) => (now - new Date(e.created_at).getTime()) / DAY;
      const last30 = enquiries.filter(e => age(e) <= 30).length;
      const prev30 = enquiries.filter(e => age(e) > 30 && age(e) <= 60).length;
      const trend = prev30 === 0
        ? (last30 ? `up from none in the 30 days before` : '')
        : `against ${prev30} in the 30 days before`;
      cards.push({
        icon: 'trending-up',
        title: 'Enquiries this month',
        detail: `${last30} ${last30 === 1 ? 'enquiry' : 'enquiries'} in the last 30 days${trend ? ', ' + trend : ''}.`,
      });
    }

    // 2. What is waiting on the dealer right now.
    //
    // Replaces the invented "top 15% of dealers" with the thing that claim was
    // pretending to be about: whether anyone is being kept waiting.
    const unworked = enquiries.filter(e => (e.status ?? 'new') === 'new').length;
    const pendingDrives = this.testDriveRequests().filter(
      r => (r.status ?? 'Pending') === 'Pending',
    ).length;
    if (unworked || pendingDrives) {
      const parts: string[] = [];
      if (unworked) parts.push(`${unworked} ${unworked === 1 ? 'enquiry' : 'enquiries'} not yet worked`);
      if (pendingDrives) parts.push(`${pendingDrives} test ${pendingDrives === 1 ? 'drive' : 'drives'} awaiting a date`);
      cards.push({
        icon: 'star',
        title: 'Waiting on you',
        detail: `${parts.join(' and ')}. A buyer who enquired is comparing you against whoever replies first.`,
      });
    }

    // 3. Stock that has been sitting.
    //
    // Computed from each listing's own created_at, so it says something true
    // about this forecourt rather than about listing habits in general.
    if (cars.length) {
      const ageDays = (c: { createdAt: string }) =>
        Math.floor((now - new Date(c.createdAt).getTime()) / DAY);
      const stale = cars.filter(c => c.createdAt && ageDays(c) >= 30);
      if (stale.length) {
        const oldest = stale.reduce((a, b) => (ageDays(a) > ageDays(b) ? a : b));
        cards.push({
          icon: 'bell',
          title: 'Ageing stock',
          detail: `${stale.length} of your ${cars.length} ${cars.length === 1 ? 'listing has' : 'listings have'} been up 30 days or more — the oldest is the ${oldest.make} ${oldest.model} at ${ageDays(oldest)} days.`,
        });
      }
    }

    // 4. Where this dealer's prices sit against their own book.
    //
    // Deliberately NOT "4.2% above the national average". This dashboard holds
    // one dealer's listings, so a national comparison would be a number
    // invented to fill a card. The spread across their own stock is something
    // the data actually supports.
    const priced = cars.filter(c => c.price > 0);
    if (priced.length >= 2) {
      const prices = priced.map(c => c.price).sort((a, b) => a - b);
      const mid = Math.floor(prices.length / 2);
      const median = prices.length % 2 ? prices[mid] : Math.round((prices[mid - 1] + prices[mid]) / 2);
      cards.push({
        icon: 'trending-up',
        title: 'Your price band',
        detail: `${priced.length} priced ${priced.length === 1 ? 'listing' : 'listings'} from ${this.formatRupees(prices[0])} to ${this.formatRupees(prices[prices.length - 1])}, median ${this.formatRupees(median)}.`,
      });
    }

    return cards;
  });

  /** Lakh/crore short form, the way every other price on the site reads. */
  formatRupees(p: number): string {
    if (p >= 10000000) return `₹${(p / 10000000).toFixed(2)} Cr`;
    if (p >= 100000) return `₹${(p / 100000).toFixed(2)}L`;
    return `₹${p.toLocaleString('en-IN')}`;
  }


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
  /** The enquiry whose status is being written, so its select can disable. */
  savingEnquiryId = signal<string | null>(null);
  /** The enquiry whose last status write failed. */
  enquiryStatusError = signal<string | null>(null);

  /**
   * Dealers an admin can hand an enquiry to (027). Empty before anyone is
   * onboarded, which is the go-live case and why the control says so rather
   * than offering an empty dropdown.
   */
  assignableSellers = signal<Seller[]>([]);

  /**
   * How long an enquiry has been waiting, in days.
   *
   * Shown because a handover is a transfer of a live lead, not a queue being
   * drained. A car enquiry has a shelf life of weeks: passing a dealer
   * something from three months ago is asking them to cold-call someone who
   * has already bought, and it starts the relationship with dead numbers.
   * Making the age visible is what lets an admin decline to hand one over.
   */
  enquiryAgeDays(createdAt: string): number {
    return Math.floor((Date.now() - new Date(createdAt).getTime()) / 86_400_000);
  }

  /** Old enough that handing it to a dealer needs a second thought. */
  isStaleEnquiry(createdAt: string): boolean {
    return this.enquiryAgeDays(createdAt) >= 30;
  }

  /**
   * Hand an enquiry to a dealer, or take it back.
   *
   * Deliberately an explicit act on one row rather than a bulk "assign all
   * unassigned". An enquiry against catalogue stock has no dealer by
   * construction — it is manufacturer inventory, not somebody's advert — and
   * a bulk action would sweep those into a handover along with the rest.
   */
  async assignEnquiry(enquiry: CarEnquiry, sellerId: string): Promise<void> {
    const next = sellerId ? Number(sellerId) : null;
    if (next === (enquiry.assigned_seller_id ?? null)) return;

    const previousId = enquiry.assigned_seller_id ?? null;
    const previousAt = enquiry.assigned_to_dealer_at ?? null;
    const assignedAt = next ? new Date().toISOString() : null;

    this.savingEnquiryId.set(enquiry.id);
    this.enquiryStatusError.set(null);
    this.enquiries.update(rows =>
      rows.map(r =>
        r.id === enquiry.id
          ? { ...r, assigned_seller_id: next, assigned_to_dealer_at: assignedAt }
          : r,
      ),
    );

    try {
      const { error } = await this.sb.client
        .from('car_enquiries')
        .update({ assigned_seller_id: next, assigned_to_dealer_at: assignedAt })
        .eq('id', enquiry.id);
      if (error) throw error;
    } catch (err) {
      console.error('Could not assign enquiry:', err);
      this.enquiries.update(rows =>
        rows.map(r =>
          r.id === enquiry.id
            ? { ...r, assigned_seller_id: previousId, assigned_to_dealer_at: previousAt }
            : r,
        ),
      );
      this.enquiryStatusError.set(enquiry.id);
    } finally {
      this.savingEnquiryId.set(null);
    }
  }

  /** The dealer's name for a row, for display. */
  sellerName(id: number | null | undefined): string {
    if (!id) return '';
    return this.assignableSellers().find(s => s.id === id)?.business_name ?? `#${id}`;
  }

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

  /**
   * Record which sales executive is handling this drive (026).
   *
   * Both fields are written together because the two inputs describe one
   * person: saving a name without the number that arrived with it would leave
   * a colleague with somebody to blame and nobody to ring.
   *
   * Trimmed, and an emptied field becomes null rather than "". A row where
   * nobody is assigned and a row assigned to the empty string are the same
   * thing to a reader and different things to a query, and the index that
   * finds unassigned requests looks for NULL.
   */
  async setTestDriveExecutive(r: TestDriveRequest, name: string, phone: string) {
    if (!r.id) return;
    const nextName = name.trim() || null;
    const nextPhone = phone.trim() || null;
    if (nextName === (r.executive_name ?? null) && nextPhone === (r.executive_phone ?? null)) {
      return;
    }
    await this.writeTestDrive(r, { executive_name: nextName, executive_phone: nextPhone });
  }

  private async writeTestDrive(
    r: TestDriveRequest,
    changes: {
      status?: string;
      outcome?: string | null;
      executive_name?: string | null;
      executive_phone?: string | null;
    },
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
    // Only an admin assigns, so only an admin needs the list. A dealer
    // fetching every other dealer's business details serves nothing.
    if (this.auth.isAdmin()) {
      this.sellersSvc.listAll().then(rows => this.assignableSellers.set(rows));
    }
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
  /**
   * Move an enquiry along.
   *
   * Optimistic, then reverted on failure — the same shape as the car-leads
   * status write above, because these are two views of the same job and a
   * dealer should not have to learn that one of them lies about having saved.
   *
   * The write is allowed by the UPDATE policy in 025, which reuses 024's read
   * rule verbatim: whoever may see an enquiry may move it. Anyone else is
   * refused by the database, not merely by this component — the anon key ships
   * in the browser bundle, so a check here alone would be advisory.
   */
  async setEnquiryStatus(enquiry: CarEnquiry, status: LeadStatus): Promise<void> {
    const previous = enquiry.status;
    if (previous === status) return;

    this.savingEnquiryId.set(enquiry.id);
    this.enquiryStatusError.set(null);
    this.enquiries.update(rows =>
      rows.map(r => (r.id === enquiry.id ? { ...r, status } : r)),
    );

    try {
      const { error } = await this.sb.client
        .from('car_enquiries')
        .update({ status })
        .eq('id', enquiry.id);

      if (error) throw error;
    } catch (err) {
      console.error('Could not save enquiry status:', err);
      this.enquiries.update(rows =>
        rows.map(r => (r.id === enquiry.id ? { ...r, status: previous } : r)),
      );
      this.enquiryStatusError.set(enquiry.id);
    } finally {
      this.savingEnquiryId.set(null);
    }
  }

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

  /**
   * How many scored leads sit in a grade.
   *
   * The AI Lead Intelligence chips read
   * `sentimentSummary()?.grade_a ?? countGrade('A')`, and this used to count
   * the six invented buyers — so whenever the sentiment service had nothing
   * to say, the panel confidently reported an AI grading of customers who
   * did not exist. It reads the real scored leads now, and answers zero when
   * there are none, which is the honest fallback for a fallback.
   */
  countGrade(grade: 'A' | 'B' | 'C' | 'D') {
    return this.sentimentLeads().filter(l => l.lead_grade === grade).length;
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
