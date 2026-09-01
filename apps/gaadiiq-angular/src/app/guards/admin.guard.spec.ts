/**
 * adminGuard sends you back to where you were going.
 *
 * `returnUrl` was the literal string '/admin/pdf-ingestion'. Signing in to
 * reach any of the eleven admin screens therefore landed you on File Ingestion,
 * and the page you actually clicked was simply gone — noticed only when the
 * loan queue was added and clicking "Loan Applications" opened File Ingestion.
 */
import { TestBed } from '@angular/core/testing';
import { Router, RouterStateSnapshot, UrlTree } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';

import { adminGuard } from './admin.guard';
import { AuthService } from '../services/auth.service';

function run(url: string, auth: Partial<AuthService>): boolean | UrlTree {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [RouterTestingModule],
    providers: [{ provide: AuthService, useValue: auth }],
  });
  return TestBed.runInInjectionContext(() =>
    adminGuard({} as never, { url } as RouterStateSnapshot),
  ) as boolean | UrlTree;
}

const signedOut = { isLoggedIn: () => false, isAdmin: () => false } as never;

describe('adminGuard', () => {
  it('returns you to the admin page you asked for', () => {
    const tree = run('/admin/loans', signedOut) as UrlTree;
    expect(tree.queryParams['returnUrl']).toBe('/admin/loans');
  });

  it('does the same for the other admin screens', () => {
    // The hardcoded value happened to be right for exactly one route, which is
    // why this went unnoticed for so long.
    const tree = run('/admin/mechanics', signedOut) as UrlTree;
    expect(tree.queryParams['returnUrl']).toBe('/admin/mechanics');
  });

  it('keeps query parameters that were part of the request', () => {
    const tree = run('/admin/loans?status=partner_selected', signedOut) as UrlTree;
    expect(tree.queryParams['returnUrl']).toBe('/admin/loans?status=partner_selected');
  });

  it('lets an admin straight through', () => {
    const result = run('/admin/loans', {
      isLoggedIn: () => true, isAdmin: () => true,
    } as never);
    expect(result).toBeTrue();
  });

  it('sends a signed-in non-admin home rather than to the login page', () => {
    // Unchanged: asking someone who is already signed in to sign in again tells
    // them nothing about why they cannot see the page.
    const result = run('/admin/loans', {
      isLoggedIn: () => true, isAdmin: () => false,
    } as never) as UrlTree;
    const router = TestBed.inject(Router);
    expect(router.serializeUrl(result)).toBe('/');
  });
});
