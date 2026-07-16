import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

export const authGuard = (route: any) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (auth.isLoggedIn()) return true;

  const returnUrl = '/' + (route?.routeConfig?.path ?? '');
  return router.createUrlTree(['/login'], { queryParams: { returnUrl } });
};
