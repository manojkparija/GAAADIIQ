import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', loadComponent: () => import('./pages/home/home.component').then(m => m.HomeComponent) },
  { path: 'listings', loadComponent: () => import('./pages/listings/listings.component').then(m => m.ListingsComponent) },
  { path: 'cars/:id', loadComponent: () => import('./pages/car-detail/car-detail.component').then(m => m.CarDetailComponent) },
  { path: '**', redirectTo: '' },
];
