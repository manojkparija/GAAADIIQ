import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

export const sellerGuard = (route: any) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const user = auth.currentUser();

  if (user?.role === 'seller' || user?.role === 'admin') return true;

  const returnUrl = '/' + (route?.routeConfig?.path ?? '');

  // Not logged in → go to login, preserve destination
  if (!user) return router.createUrlTree(['/login'], { queryParams: { returnUrl } });

  // Logged in as customer → go to home
  return router.createUrlTree(['/'], { queryParams: { accessDenied: '1' } });
};
