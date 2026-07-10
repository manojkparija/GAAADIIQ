import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

export const sellerGuard = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const user = auth.currentUser();

  if (user?.role === 'seller' || user?.role === 'admin') return true;

  // Not logged in → go to login
  if (!user) return router.createUrlTree(['/login']);

  // Logged in as customer → go to home with an alert
  return router.createUrlTree(['/'], { queryParams: { accessDenied: '1' } });
};
