import { Routes } from '@angular/router';
import { sellerGuard } from './guards/seller.guard';
import { authGuard } from './guards/auth.guard';
import { adminGuard } from './guards/admin.guard';

export const routes: Routes = [
  { path: '', loadComponent: () => import('./pages/home/home.component').then(m => m.HomeComponent) },
  { path: 'listings', loadComponent: () => import('./pages/listings/listings.component').then(m => m.ListingsComponent) },
  { path: 'new-cars', loadComponent: () => import('./pages/new-cars/new-cars.component').then(m => m.NewCarsComponent) },
  { path: 'used-cars', loadComponent: () => import('./pages/used-cars/used-cars.component').then(m => m.UsedCarsComponent) },
  { path: 'cars/:id', loadComponent: () => import('./pages/car-detail/car-detail.component').then(m => m.CarDetailComponent) },
  { path: 'login', loadComponent: () => import('./pages/login/login.component').then(m => m.LoginComponent) },
  { path: 'register', loadComponent: () => import('./pages/register/register.component').then(m => m.RegisterComponent) },
  { path: 'ai-advisor', loadComponent: () => import('./pages/ai-advisor/ai-advisor.component').then(m => m.AiAdvisorComponent) },
  { path: 'compare', loadComponent: () => import('./pages/compare/compare.component').then(m => m.CompareComponent) },
  { path: 'emi-calculator', loadComponent: () => import('./pages/emi-calculator/emi-calculator.component').then(m => m.EmiCalculatorComponent) },
  { path: 'car-loan', loadComponent: () => import('./pages/car-loan/car-loan.component').then(m => m.CarLoanComponent) },
  { path: 'list-car', loadComponent: () => import('./pages/list-car/list-car.component').then(m => m.ListCarComponent), canActivate: [authGuard] },
  { path: 'reviews-news', loadComponent: () => import('./pages/reviews-news/reviews-news.component').then(m => m.ReviewsNewsComponent) },
  { path: 'reviews-news/:category', loadComponent: () => import('./pages/reviews-news/reviews-news.component').then(m => m.ReviewsNewsComponent) },
  { path: 'reviews-news/:category/:id', loadComponent: () => import('./pages/article-detail/article-detail.component').then(m => m.ArticleDetailComponent) },
  { path: 'reviews-news/:category/live/:index', loadComponent: () => import('./pages/live-news-detail/live-news-detail.component').then(m => m.LiveNewsDetailComponent) },
  { path: 'my-listings', loadComponent: () => import('./pages/my-listings/my-listings.component').then(m => m.MyListingsComponent), canActivate: [authGuard] },
  { path: 'price-alerts', loadComponent: () => import('./pages/price-alerts/price-alerts.component').then(m => m.PriceAlertsComponent), canActivate: [authGuard] },
  { path: 'test-drive', loadComponent: () => import('./pages/test-drive/test-drive.component').then(m => m.TestDriveComponent) },
  { path: 'buyer-journey', loadComponent: () => import('./pages/buyer-journey/buyer-journey.component').then(m => m.BuyerJourneyComponent) },
  { path: 'dealer-dashboard', loadComponent: () => import('./pages/dealer-dashboard/dealer-dashboard.component').then(m => m.DealerDashboardComponent), canActivate: [sellerGuard] },
  { path: 'admin/pricing', loadComponent: () => import('./pages/admin-pricing/admin-pricing.component').then(m => m.AdminPricingComponent), canActivate: [sellerGuard] },
  { path: 'admin/pdf-ingestion', loadComponent: () => import('./pages/admin-pdf-ingestion/admin-pdf-ingestion.component').then(m => m.AdminPdfIngestionComponent), canActivate: [adminGuard] },
  { path: 'admin/variants', loadComponent: () => import('./pages/admin-variants/admin-variants.component').then(m => m.AdminVariantsComponent), canActivate: [adminGuard] },
  { path: 'admin/car-images', loadComponent: () => import('./pages/admin-car-images/admin-car-images.component').then(m => m.AdminCarImagesComponent), canActivate: [adminGuard] },
  { path: 'admin/image-review', loadComponent: () => import('./pages/admin-image-review/admin-image-review.component').then(m => m.AdminImageReviewComponent), canActivate: [adminGuard] },
  { path: 'admin/mechanics', loadComponent: () => import('./pages/admin-mechanics/admin-mechanics.component').then(m => m.AdminMechanicsComponent), canActivate: [adminGuard] },
  { path: 'pricing-plans', loadComponent: () => import('./pages/pricing-plans/pricing-plans.component').then(m => m.PricingPlansComponent) },
  { path: 'ai-valuation', loadComponent: () => import('./pages/ai-valuation/ai-valuation.component').then(m => m.AiValuationComponent) },
  // No guard: the page itself distinguishes signed-out, signed-in-but-not-a-
  // mechanic, and mechanic — a guard would only be able to bounce all three the
  // same way.
  { path: 'mechanic-dashboard', loadComponent: () => import('./pages/mechanic-dashboard/mechanic-dashboard.component').then(m => m.MechanicDashboardComponent) },
  { path: 'mechanic-signup', loadComponent: () => import('./pages/mechanic-signup/mechanic-signup.component').then(m => m.MechanicSignupComponent) },
  { path: 'vehicle-diagnosis', loadComponent: () => import('./pages/vehicle-diagnosis/vehicle-diagnosis.component').then(m => m.VehicleDiagnosisComponent) },
  { path: 'about', loadComponent: () => import('./pages/about/about.component').then(m => m.AboutComponent) },
  { path: 'brand-logos', loadComponent: () => import('./pages/brand-logos/brand-logos.component').then(m => m.BrandLogosComponent) },
  { path: 'reset-password', loadComponent: () => import('./pages/reset-password/reset-password.component').then(m => m.ResetPasswordComponent) },
  { path: 'profile', loadComponent: () => import('./pages/profile/profile.component').then(m => m.ProfileComponent), canActivate: [authGuard] },
  { path: 'ev-calculator', loadComponent: () => import('./pages/ev-calculator/ev-calculator.component').then(m => m.EvCalculatorComponent) },
  { path: 'privacy-policy', loadComponent: () => import('./pages/privacy-policy/privacy-policy.component').then(m => m.PrivacyPolicyComponent) },
  { path: 'terms-of-service', loadComponent: () => import('./pages/terms-of-service/terms-of-service.component').then(m => m.TermsOfServiceComponent) },
  { path: 'cookie-policy', loadComponent: () => import('./pages/cookie-policy/cookie-policy.component').then(m => m.CookiePolicyComponent) },
  // Ported from the Next.js app before it was removed.
  //
  // Its /forgot-password page was deliberately NOT ported: it called the API's
  // /auth/forgot-password, which resets hashed_password in the API's own users
  // table. This app signs in through Supabase, where that column is null and
  // plays no part in login, so the page would have appeared to work while
  // changing nothing. Password reset here already goes through Supabase, from
  // the "Forgot password?" link on the login page.
  { path: 'tco', loadComponent: () => import('./pages/tco/tco.component').then(m => m.TcoComponent) },
  // Roadside help. A route of its own rather than only a modal, so it can sit in
  // the navbar, be bookmarked before it is needed, and be sent to someone in a
  // message — which is how a stranded person actually reaches it.
  { path: 'find-mechanic', loadComponent: () => import('./pages/find-mechanic/find-mechanic.component').then(m => m.FindMechanicComponent) },
  { path: 'notifications', loadComponent: () => import('./pages/notifications/notifications.component').then(m => m.NotificationsComponent), canActivate: [authGuard] },
  { path: 'leads', loadComponent: () => import('./pages/leads/leads.component').then(m => m.LeadsComponent), canActivate: [sellerGuard] },
  { path: 'analytics', loadComponent: () => import('./pages/analytics/analytics.component').then(m => m.AnalyticsComponent), canActivate: [sellerGuard] },
  { path: '**', redirectTo: '' },
];
