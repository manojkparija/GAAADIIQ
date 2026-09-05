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
import { catchError, from, Observable, of, switchMap } from 'rxjs';
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

  // A session that cannot be read must not take the request with it.
  //
  // REPORTED FROM THE LIVE SITE, FOR MOST OF A DAY
  //
  // "0 models available" on a normal reload, the full catalogue after a hard
  // refresh, every time. The API was healthy throughout — the same URLs the app
  // calls returned the whole catalogue when opened in a tab — and the responses
  // were uncached in both directions, because a request carrying Authorization
  // is stamped no-store by core/cache_policy.py.
  //
  // The failure was here. `getSession()` is asynchronous and talks to storage,
  // and refreshes the token over the network when it has expired. Any rejection
  // — the client still initialising, a refresh that fails, storage unavailable
  // in a locked-down browser — errored this observable, and `next(req)` was
  // never reached. The request was not sent at all.
  //
  // Every API call in the app passes through here, and CarsDataService loads the
  // catalogue from its constructor, which is the earliest moment in the app's
  // life and the most likely to lose that race. A normal reload serves the
  // bundles from cache and boots fast, so it raced; a hard refresh re-downloads
  // them, so the session was ready by the time the catalogue asked. That is the
  // whole of "why do I need to hard refresh".
  //
  // Failing open is the right direction and not a security hole: it drops the
  // Authorization header, it never forges one. A public endpoint answers as it
  // does for any signed-out visitor, and a protected one returns 401 — which is
  // exactly what an unreadable session means. The alternative, which is what
  // shipped, is that a signed-in user with a momentarily unreadable session
  // cannot read the public catalogue either.
  return from(supa.client.auth.getSession()).pipe(
    catchError(() => of({ data: { session: null } })),
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
