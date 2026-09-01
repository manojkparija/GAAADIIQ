import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

/**
 * Admin-only routes.
 *
 * `returnUrl` is the route that was actually asked for. It used to be the
 * string '/admin/pdf-ingestion', hardcoded — so signing in to reach any of the
 * eleven admin screens landed you on File Ingestion instead, and the page you
 * clicked was simply gone. Nobody noticed because these screens sit behind this
 * guard and are rarely opened cold.
 */
export const adminGuard: CanActivateFn = (_route, state) => {
  const auth   = inject(AuthService);
  const router = inject(Router);

  if (auth.isLoggedIn() && auth.isAdmin()) return true;
  if (auth.isLoggedIn()) return router.createUrlTree(['/']);
  return router.createUrlTree(['/login'], { queryParams: { returnUrl: state.url } });
};
