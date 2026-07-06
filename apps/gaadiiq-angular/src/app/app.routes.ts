import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', loadComponent: () => import('./pages/home/home.component').then(m => m.HomeComponent) },
  { path: 'listings', loadComponent: () => import('./pages/listings/listings.component').then(m => m.ListingsComponent) },
  { path: 'cars/:id', loadComponent: () => import('./pages/car-detail/car-detail.component').then(m => m.CarDetailComponent) },
  { path: 'login', loadComponent: () => import('./pages/login/login.component').then(m => m.LoginComponent) },
  { path: 'register', loadComponent: () => import('./pages/register/register.component').then(m => m.RegisterComponent) },
  { path: 'ai-advisor', loadComponent: () => import('./pages/ai-advisor/ai-advisor.component').then(m => m.AiAdvisorComponent) },
  { path: 'compare', loadComponent: () => import('./pages/compare/compare.component').then(m => m.CompareComponent) },
  { path: 'emi-calculator', loadComponent: () => import('./pages/emi-calculator/emi-calculator.component').then(m => m.EmiCalculatorComponent) },
  { path: 'list-car', loadComponent: () => import('./pages/list-car/list-car.component').then(m => m.ListCarComponent) },
  { path: 'reviews-news', loadComponent: () => import('./pages/reviews-news/reviews-news.component').then(m => m.ReviewsNewsComponent) },
  { path: 'my-listings', loadComponent: () => import('./pages/my-listings/my-listings.component').then(m => m.MyListingsComponent) },
  { path: 'price-alerts', loadComponent: () => import('./pages/price-alerts/price-alerts.component').then(m => m.PriceAlertsComponent) },
  { path: 'test-drive', loadComponent: () => import('./pages/test-drive/test-drive.component').then(m => m.TestDriveComponent) },
  { path: '**', redirectTo: '' },
];
