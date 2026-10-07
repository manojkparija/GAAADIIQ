/**
 * Every /admin/* route is guarded as an admin route.
 *
 * FOUND BY READING THE ROUTE TABLE AGAINST THE MENUS AND THE API
 *
 * /admin/pricing carried sellerGuard. It was the only one of twelve that did,
 * and all three other sources of truth disagreed with it:
 *
 *   the navbar  — lists Price Manager under *ngIf="auth.isAdmin()", in both
 *                 the desktop dropdown and the mobile menu, so no seller has
 *                 ever been offered a link to it;
 *   the API     — PATCH /cars/{id} is Depends(get_admin_user), so a seller's
 *                 save is refused;
 *   the page    — edits the shared catalogue (make, model, variant, year,
 *                 ex_showroom_price), not the seller's own listings.
 *
 * So no data was ever at risk. What a seller could do was type the URL, be let
 * in, read every catalogue price, edit one, and discover on save that they
 * could not. A page that admits you and then refuses you is worse than one
 * that refuses you at the door: the refusal arrives after the work.
 *
 * WHY THE WHOLE PREFIX RATHER THAN THE ONE ROUTE
 *
 * Asserting only that /admin/pricing uses adminGuard would have passed on the
 * day before this was noticed, because the fault was not that a rule existed
 * and was broken — there was no rule. This states it: the prefix means admin.
 * Anything added under /admin/ later has to say so too, or fails here.
 */
import { Route } from '@angular/router';

import { routes } from './app.routes';
import { adminGuard } from './guards/admin.guard';

/** Flattened, because a child route is as reachable as a top-level one. */
function allRoutes(rs: Route[], prefix = ''): { path: string; route: Route }[] {
  const out: { path: string; route: Route }[] = [];
  for (const r of rs) {
    const path = [prefix, r.path ?? ''].filter(Boolean).join('/');
    out.push({ path, route: r });
    if (r.children) out.push(...allRoutes(r.children, path));
  }
  return out;
}

describe('app.routes — the /admin prefix means admin', () => {
  const adminRoutes = allRoutes(routes).filter(
    ({ path }) => path === 'admin' || path.startsWith('admin/'),
  );

  it('has admin routes to check', () => {
    // Guards against the suite silently passing because a refactor renamed the
    // prefix and this file now matches nothing.
    expect(adminRoutes.length).toBeGreaterThan(5);
  });

  it('guards every one of them with adminGuard', () => {
    for (const { path, route } of adminRoutes) {
      expect(route.canActivate ?? [])
        .withContext(`/${path} is reachable without adminGuard`)
        .toContain(adminGuard);
    }
  });

  it('guards /admin/pricing specifically', () => {
    // The one that was wrong, named so the regression is readable.
    const pricing = adminRoutes.find(({ path }) => path === 'admin/pricing');

    expect(pricing).withContext('/admin/pricing has gone missing').toBeTruthy();
    expect(pricing!.route.canActivate).toContain(adminGuard);
  });

  it('leaves the seller routes alone', () => {
    // The fix must not sweep up the pages sellers are supposed to have. These
    // are theirs, and none of them lives under /admin.
    const sellerPaths = ['dealer-dashboard', 'leads', 'analytics'];

    for (const p of sellerPaths) {
      const found = allRoutes(routes).find(({ path }) => path === p);
      expect(found).withContext(`${p} has gone missing`).toBeTruthy();
      expect(found!.route.canActivate ?? [])
        .withContext(`${p} should not have become admin-only`)
        .not.toContain(adminGuard);
    }
  });
});
