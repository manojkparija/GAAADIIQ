import {
  AfterViewInit,
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  computed,
  inject,
  signal,
} from '@angular/core';
import { RouterLink, RouterLinkActive, Router, NavigationEnd } from '@angular/router';
import { CommonModule } from '@angular/common';
import { LogoComponent } from '../logo/logo.component';
import { IconComponent } from '../icon/icon.component';
import { AuthService } from '../../services/auth.service';
import { ThemeService } from '../../services/theme.service';
import { CityService } from '../../services/city.service';
import { LanguageService, LANGUAGES, Lang } from '../../services/language.service';
import { CitySelectorComponent } from '../city-selector/city-selector.component';
import { CarsDataService } from '../../services/cars-data.service';
import { TranslatePipe } from '../../pipes/translate.pipe';

@Component({
  selector: 'app-navbar',
  standalone: true,
  imports: [LogoComponent, RouterLink, RouterLinkActive, CommonModule, CitySelectorComponent, IconComponent, TranslatePipe],
  templateUrl: './navbar.component.html',
  styleUrl: './navbar.component.scss'
})
export class NavbarComponent implements AfterViewInit, OnDestroy {
  private static readonly DARK_HERO_ROUTES = ['/new-cars', '/used-cars'];

  /** Routes reachable from the More menu. Keep in step with the panel's links. */
  private static readonly MORE_ROUTES = ['/track-challan', '/video-review', '/ev-charging'];
  private readonly host = inject(ElementRef);
  private resizeObserver?: ResizeObserver;

  private _scrolled = signal(false);
  private _darkHero = signal(false);
  scrolled = computed(() => this._scrolled() || this._darkHero());

  // ── New Cars mega-menu ───────────────────────────────────────────────────
  newCarsOpen = signal(false);

  /**
   * Only what the site can actually answer.
   *
   * The menu this was modelled on lists Offers & Discounts, Find Dealers, EV
   * Charging Stations and Fuel Prices. We have no offers data, no dealer
   * directory and no station data, so those would be entries that look like
   * navigation and lead nowhere — worse than a shorter menu, because a dead
   * link costs a click and some trust before it teaches the reader anything.
   *
   * Every entry below resolves to a page that exists, using query parameters
   * /new-cars already honours (bodyType, fuel, make).
   */
  readonly bodyTypes = ['SUV', 'Hatchback', 'Sedan', 'MUV'];
  readonly fuels = ['Electric', 'Petrol', 'Diesel', 'CNG', 'Hybrid'];

  /**
   * Brands taken from the catalogue rather than a fixed list, so the menu can
   * never offer a make with nothing behind it. It grows on its own as cars are
   * added.
   *
   * The test below the filter is the exact one listings.component.ts uses to
   * decide what "New" means (km === 0 && year >= 2024) — deliberately copied
   * rather than loosened. If the menu listed every make in the catalogue, the
   * makes with only used stock would render as chips that land on an empty
   * New Cars page. A short list here is the catalogue being short of new cars,
   * not the menu hiding them.
   */
  newCarBrands = computed(() => {
    const makes = this.carsData.cars()
      .filter(c => c.km === 0 && c.year >= 2024)
      .map(c => c.make)
      .filter(Boolean);
    return [...new Set(makes)].sort();
  });

  // ── Used Cars menu ───────────────────────────────────────────────────────
  usedCarsOpen = signal(false);

  /**
   * Budget bands, the way people actually shop for a used car — the first
   * question is almost always "what can I get for X", not which body type.
   * `maxBudget` is a query parameter used-cars.component.ts already reads.
   */
  readonly usedBudgets: { label: string; max: number }[] = [
    { label: 'Under ₹3L', max: 300000 },
    { label: 'Under ₹5L', max: 500000 },
    { label: 'Under ₹10L', max: 1000000 },
    { label: 'Under ₹15L', max: 1500000 },
  ];

  /**
   * Makes with used stock, by the same test the Used Cars page uses (km > 0).
   * Same reasoning as the new-car brands above: a chip that lands on an empty
   * result page is worse than no chip.
   */
  usedCarBrands = computed(() => {
    const makes = this.carsData.cars()
      .filter(c => (c.km ?? 0) > 0)
      .map(c => c.make)
      .filter(Boolean);
    return [...new Set(makes)].sort();
  });

  /**
   * Opening one menu closes the other. Two panels open at once overlap, and
   * the lower one is unreachable behind the upper.
   */
  toggleNewCars(): void {
    this.closeOthers('newCars');
    this.newCarsOpen.update(v => !v);
  }
  closeNewCars(): void { this.newCarsOpen.set(false); }

  toggleUsedCars(): void {
    this.closeOthers('usedCars');
    this.usedCarsOpen.update(v => !v);
  }
  closeUsedCars(): void { this.usedCarsOpen.set(false); }

  /**
   * The AI row, as data rather than four hand-written blocks. routerLinkActive
   * gives each tab its selected state, so the gradient marks where you are
   * instead of tracking it in a signal that can disagree with the URL.
   */
  readonly aiTabs: { link: string; icon: string; label: string }[] = [
    { link: '/ai-advisor',       icon: 'sparkles',      label: 'AI Advisor' },
    { link: '/vehicle-diagnosis', icon: 'wrench',       label: 'AI Diagnosis' },
    { link: '/ai-valuation',     icon: 'indian-rupee',  label: 'AI Car Value' },
    { link: '/find-mechanic',    icon: 'map-pin',       label: 'Find Mechanic' },
  ];

  /**
   * New-car budget bands. /new-cars reads minPrice and maxPrice — NOT the
   * maxBudget the used-car page uses. Two pages, two parameter names; sending
   * the wrong one filters nothing and reports no error.
   */
  readonly newCarBudgets: { label: string; min: number; max: number }[] = [
    { label: 'Under ₹5L',  min: 0,        max: 500000 },
    { label: '₹5 – 10L',   min: 500000,   max: 1000000 },
    { label: '₹10 – 20L',  min: 1000000,  max: 2000000 },
    { label: 'Above ₹20L', min: 2000000,  max: 100000000 },
  ];

  // ── EMI & Loan ───────────────────────────────────────────────────────────
  financeOpen = signal(false);

  toggleFinance(): void {
    this.closeOthers('finance');
    this.financeOpen.update(v => !v);
  }

  // ── More (AI row) ────────────────────────────────────────────────────────
  moreOpen = signal(false);

  /** True while the current route is one of the pages listed inside More. */
  private readonly _moreActive = signal(false);
  readonly moreActive = this._moreActive.asReadonly();

  toggleMore(): void {
    this.closeOthers('more');
    this.moreOpen.update(v => !v);
  }

  // ── Insurance ────────────────────────────────────────────────────────────
  insuranceOpen = signal(false);

  toggleInsurance(): void {
    this.closeOthers('insurance');
    this.insuranceOpen.update(v => !v);
  }

  /**
   * Close every panel except the one being opened.
   *
   * This replaces four hand-written lists of "set the other three false",
   * which is a shape that quietly rots: adding a fifth menu means editing four
   * unrelated methods, and missing one leaves two panels open on top of each
   * other with the lower one unreachable. Adding a menu now means adding it
   * here once.
   */
  private closeOthers(
    keep: 'newCars' | 'usedCars' | 'finance' | 'insurance' | 'more' | 'lang' | 'none',
  ): void {
    if (keep !== 'newCars') this.newCarsOpen.set(false);
    if (keep !== 'usedCars') this.usedCarsOpen.set(false);
    if (keep !== 'finance') this.financeOpen.set(false);
    if (keep !== 'insurance') this.insuranceOpen.set(false);
    if (keep !== 'more') this.moreOpen.set(false);
    if (keep !== 'lang') this.langOpen.set(false);
  }

  // ── Language picker ──────────────────────────────────────────────────────
  readonly languages = LANGUAGES;
  langOpen = signal(false);

  toggleLang(): void {
    this.closeOthers('lang');
    this.langOpen.update(v => !v);
  }

  chooseLang(code: Lang): void {
    this.lang.set(code);
    this.langOpen.set(false);
  }

  /** The label for the language in use, for the closed picker. */
  currentLangLabel(): string {
    return LANGUAGES.find(l => l.code === this.lang.lang())?.label ?? 'English';
  }

  menuOpen = signal(false);
  userMenuOpen = signal(false);
  cityModalOpen = signal(false);


  constructor(
    public auth: AuthService,
    public theme: ThemeService,
    public city: CityService,
    public lang: LanguageService,
    private carsData: CarsDataService,
    router: Router
  ) {
    router.events.subscribe(e => {
      // A menu left open across a navigation covers the page you just asked for.
      if (e instanceof NavigationEnd) {
        this.closeOthers('none');
      }
      if (e instanceof NavigationEnd) {
        this._darkHero.set(NavbarComponent.DARK_HERO_ROUTES.some(r => e.urlAfterRedirects?.startsWith(r)));
        // The four tabs get their highlight from routerLinkActive. More is a
        // <button>, so it has no route of its own to match — its selected
        // state is "you are on one of the pages inside it", tracked here.
        this._moreActive.set(
          NavbarComponent.MORE_ROUTES.some(r => e.urlAfterRedirects?.startsWith(r)),
        );
      }
    });
  }

  @HostListener('window:scroll')
  onScroll() { this._scrolled.set(window.scrollY > 12); }

  /**
   * Publish the bar's real height as --nav-height (LAY-007).
   *
   * styles.scss carried this as a hand-measured literal, with a comment saying
   * it had already gone stale twice — 34px out after the two-row change, 23px
   * after the redesign. Adding the phone nav strip made it stale a third time,
   * by 65px: the bar became 176px while the token still said 111, so every
   * page's own <h1> rendered underneath it and the headings simply vanished.
   *
   * A literal that must be re-measured by hand whenever the bar's contents or
   * type change will keep going stale. The bar now measures itself, so the
   * next row added here needs no second edit anywhere.
   *
   * The literal stays in styles.scss as the first-paint value, before this
   * runs, and is set to the taller of the measured widths — over-padding by a
   * few pixels for one frame is invisible, under-padding hides text.
   */
  private publishNavHeight(): void {
    // The bar COMPACTS on scroll (176 -> smaller). Publishing that shorter
    // height would let content slide up under the resting bar the moment the
    // user scrolls back to the top, so only the resting height is written.
    if (this.scrolled()) return;
    const h = this.host.nativeElement.querySelector('.navbar')?.getBoundingClientRect().height;
    if (h && h > 0) {
      document.documentElement.style.setProperty('--nav-height', `${Math.ceil(h)}px`);
    }
  }

  ngAfterViewInit(): void {
    this.publishNavHeight();
    // Catches rotation, a font finishing loading, and the row wrapping at a
    // width nobody thought to test — none of which fire a scroll or resize in
    // every browser.
    this.resizeObserver = new ResizeObserver(() => this.publishNavHeight());
    const bar = this.host.nativeElement.querySelector('.navbar');
    if (bar) this.resizeObserver.observe(bar);
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(e: MouseEvent) {
    const target = e.target as HTMLElement;
    if (this.userMenuOpen() && !target.closest('.user-menu-wrap')) {
      this.userMenuOpen.set(false);
    }
    if (!target.closest('.nav-dropdown')) {
      this.newCarsOpen.set(false);
      this.usedCarsOpen.set(false);
      this.financeOpen.set(false);
      this.insuranceOpen.set(false);
      this.moreOpen.set(false);
    }
    if (this.langOpen() && !target.closest('.lang-wrap')) {
      this.langOpen.set(false);
    }
  }

  /** Escape closes the menu, so a keyboard user is not trapped inside it. */
  @HostListener('document:keydown.escape')
  onEscape() {
    this.closeOthers('none');
    this.userMenuOpen.set(false);
  }

  toggleMenu() { this.menuOpen.update(v => !v); }
  closeMenu() { this.menuOpen.set(false); }
  toggleUserMenu() { this.userMenuOpen.update(v => !v); }
  openCityModal() { this.cityModalOpen.set(true); }
  closeCityModal() { this.cityModalOpen.set(false); }

  logout() {
    this.userMenuOpen.set(false);
    this.auth.logout().catch(() => {});
  }
}
