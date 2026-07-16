import { Component, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { SeoService } from '../../services/seo.service';
import { CarsDataService } from '../../services/cars-data.service';
import { TestDriveService, TestDriveRequest } from '../../services/test-drive.service';
import { AuthService } from '../../services/auth.service';
import { SellersService, Seller } from '../../services/sellers.service';
import { SupabaseService } from '../../services/supabase.service';
import { IconComponent } from '../../components/icon/icon.component';

interface CarEnquiry {
  id: string; car_id: number; buyer_name: string; buyer_phone: string;
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
  imports: [CommonModule, RouterLink, IconComponent],
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

  activeTab = signal<'overview' | 'leads' | 'inventory' | 'analytics' | 'test-drives' | 'enquiries'>('overview');

  enquiries = signal<CarEnquiry[]>([]);
  enquiriesLoading = signal(false);

  testDriveRequests = this.testDriveSvc.requests;
  testDriveCount = computed(() => this.testDriveRequests().length);
  pendingTestDrives = computed(() => this.testDriveRequests().filter(r => r.status === 'Pending'));

  currentSeller = signal<Seller | null>(null);
  authUser = computed(() => this.auth.currentUser());
  sellerInitials = computed(() => {
    const s = this.currentSeller();
    if (!s) return '??';
    return s.business_name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  });
  authInitials = computed(() => {
    const u = this.auth.currentUser();
    if (!u) return '?';
    return u.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  });

  constructor(seo: SeoService, private testDriveSvc: TestDriveService,
              private auth: AuthService, private sellersSvc: SellersService,
              private sb: SupabaseService) {
    seo.setPage('Dealer Dashboard', 'Dealer intelligence dashboard — listings, leads, analytics.');
    this.loadSellerInfo();
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
    this.loadEnquiries(sellerId ?? null);
  }

  private async loadEnquiries(sellerId: number | null) {
    this.enquiriesLoading.set(true);
    try {
      let query = this.sb.client
        .from('car_enquiries')
        .select('*')
        .order('created_at', { ascending: false });

      // If not admin, scope to this seller's listings
      if (sellerId && !this.auth.isAdmin()) {
        const { data: listings } = await this.sb.client
          .from('car_listings')
          .select('id')
          .eq('seller_id', sellerId);
        const ids = (listings ?? []).map((l: any) => l.id);
        if (ids.length === 0) { this.enquiries.set([]); this.enquiriesLoading.set(false); return; }
        query = query.in('car_id', ids);
      }

      const { data } = await query;
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
}
