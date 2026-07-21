/**
 * AuthInterceptor — bridges Supabase session token to FastAPI RS256 JWT (MOB-002).
 *
 * Attaches the Supabase access token as a Bearer header on every request to the
 * API base URL. The FastAPI backend accepts Supabase-issued JWTs because Supabase
 * uses RS256 and the public key can be verified by the backend without a shared secret.
 *
 * For the dual-auth gap: the FastAPI /auth/* endpoints issue their own RS256 JWTs,
 * but all UI auth flows go through Supabase. The token from Supabase is forwarded
 * here so API calls work without a separate login step.
 */
import { inject } from '@angular/core';
import {
  HttpEvent,
  HttpHandlerFn,
  HttpInterceptorFn,
  HttpRequest,
} from '@angular/common/http';
import { from, Observable, switchMap } from 'rxjs';
import { SupabaseService } from '../services/supabase.service';
import { environment } from '../../environments/environment';

export const authInterceptor: HttpInterceptorFn = (
  req: HttpRequest<unknown>,
  next: HttpHandlerFn,
): Observable<HttpEvent<unknown>> => {
  // Only intercept requests to our own API
  if (!req.url.startsWith(environment.apiUrl)) {
    return next(req);
  }

  const supa = inject(SupabaseService);

  return from(supa.client.auth.getSession()).pipe(
    switchMap(({ data }) => {
      const token = data.session?.access_token;
      if (token) {
        req = req.clone({
          setHeaders: { Authorization: `Bearer ${token}` },
        });
      }
      return next(req);
    }),
  );
};
