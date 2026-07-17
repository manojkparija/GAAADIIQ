import { Component, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../services/auth.service';
import { MyListingsService } from '../../services/my-listings.service';
import { SupabaseService } from '../../services/supabase.service';
import { IconComponent } from '../../components/icon/icon.component';
import { CloudinaryService, CloudinaryResult } from '../../services/cloudinary.service';

@Component({
  selector: 'app-list-car',
  standalone: true,
  imports: [RouterLink, CommonModule, FormsModule, IconComponent],
  templateUrl: './list-car.component.html',
  styleUrl: './list-car.component.scss'
})
export class ListCarComponent {
  step = signal(1);
  totalSteps = 4;
  submitted = signal(false);
  loading = signal(false);

  uploadedImages = signal<CloudinaryResult[]>([]);
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

  onMakeChange() { this.form.model = ''; this.form.variant = ''; }
  onModelChange() { this.form.variant = ''; }

  form = {
    make: '', model: '', variant: '', year: new Date().getFullYear(), km: '',
    fuel: '', transmission: '', owners: '', color: '', city: '',
    price: '', description: '', name: '', phone: '', email: '',
    bodyType: ''
  };

  constructor(public auth: AuthService, private myListings: MyListingsService, private router: Router, private sb: SupabaseService, public cloudinary: CloudinaryService) {
    const user = auth.currentUser();
    if (user) {
      this.form.name = user.name;
      this.form.email = user.email;
    }
  }

  get years() {
    const y = [];
    for (let i = new Date().getFullYear(); i >= 2000; i--) y.push(i);
    return y;
  }

  nextStep() { if (this.step() < this.totalSteps) this.step.update(v => v + 1); }
  prevStep() { if (this.step() > 1) this.step.update(v => v - 1); }

  uploadError = signal('');

  async onFilesSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files?.length) return;
    const files = Array.from(input.files).slice(0, 10 - this.uploadedImages().length);
    if (!files.length) return;
    this.uploadLoading.set(true);
    this.uploadError.set('');
    try {
      const results = await this.cloudinary.uploadFiles(files, 'gaadiiq/cars');
      this.uploadedImages.update(existing => [...existing, ...results]);
    } catch (e: any) {
      this.uploadError.set('Upload failed. Please check your internet connection and try again.');
    } finally {
      this.uploadLoading.set(false);
      input.value = '';
    }
  }

  removeImage(index: number) {
    this.uploadedImages.update(imgs => imgs.filter((_, i) => i !== index));
  }

  imageThumb(publicId: string) {
    return this.cloudinary.imageUrl(publicId, 300);
  }

  async onSubmit() {
    this.loading.set(true);
    const user = this.auth.currentUser();

    const primaryImage = this.uploadedImages()[0];
    const imageUrl = primaryImage
      ? this.cloudinary.imageUrl(primaryImage.public_id, 800)
      : null;

    // Insert into Supabase so customers can see the listing
    const { data: inserted } = await this.sb.client
      .from('cars')
      .insert({
        make: this.form.make,
        model: this.form.model,
        variant: this.form.variant || null,
        year: this.form.year,
        km: +this.form.km,
        fuel: this.form.fuel,
        transmission: this.form.transmission,
        owners: this.form.owners || null,
        color: this.form.color || null,
        city: this.form.city || null,
        price: +this.form.price,
        body_type: this.form.bodyType || null,
        badge: 'Used',
        badge_type: 'used',
        seller_email: this.form.email,
        seller_id: user?.sellerId ?? null,
        is_seller_listing: true,
        verified: false,
        rating: 0,
        reviews: 0,
        image_url: imageUrl,
      })
      .select('id')
      .single();

    // Also save to local MyListings so seller sees it in My Listings page
    this.myListings.add({
      make: this.form.make, model: this.form.model, variant: this.form.variant,
      year: this.form.year, km: +this.form.km, fuel: this.form.fuel,
      transmission: this.form.transmission, owners: this.form.owners,
      color: this.form.color, city: this.form.city, price: +this.form.price,
      description: this.form.description, bodyType: this.form.bodyType,
      name: this.form.name, phone: this.form.phone, email: this.form.email,
      supabaseId: inserted?.id ?? null,
    });

    this.loading.set(false);
    this.submitted.set(true);
  }
}
