/**
 * AuthInterceptor — bridges Supabase session token to FastAPI RS256 JWT (MOB-002).
 *
 * Attaches the Supabase access token as a Bearer header on every request to the
 * API base URL.
 *
 * Supabase signs these with HS256 using the project JWT secret — NOT RS256, as
 * an earlier version of this comment claimed. That mistake mattered: the
 * backend only verified its own RS256 tokens, so every signed-in user was
 * rejected with "Not authenticated", and the wrong comment made the cause look
 * like it was already handled. The backend now verifies both (see
 * core/dependencies.get_current_user), which requires SUPABASE_JWT_SECRET to be
 * set on the API.
 *
 * The FastAPI /auth/* endpoints still issue their own RS256 tokens; both are
 * accepted, so no separate login step is needed.
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
import { VisitorService } from '../services/visitor.service';
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

  // The anonymous browser id, so the API can tell one person refreshing from
  // twelve people looking. Set here rather than at each call site for the same
  // reason the token is: a header attached by hand at one of them is a header
  // missing from the other nine.
  const visitorKey = inject(VisitorService).key;
  if (visitorKey) {
    req = req.clone({ setHeaders: { 'X-Visitor-Key': visitorKey } });
  }

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
