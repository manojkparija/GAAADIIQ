/**
 * The anonymous browser id.
 *
 * It answers one question — were these twelve views twelve people or one
 * person refreshing — and it has to stay stable to do it. It also must never
 * take a page down: storage is unavailable in private browsing on some
 * browsers, and analytics is not worth a blank screen.
 */

import { TestBed } from '@angular/core/testing';

import { VisitorService } from './visitor.service';

describe('VisitorService', () => {
  beforeEach(() => {
    localStorage.removeItem('gaadiiq_visitor');
    TestBed.configureTestingModule({});
  });

  afterEach(() => localStorage.removeItem('gaadiiq_visitor'));

  it('returns the same id every time for one browser', () => {
    // A key that changes per call makes every view a new "person", which is
    // the exact thing it exists to prevent.
    const svc = TestBed.inject(VisitorService);
    const first = svc.key;
    expect(first).toBeTruthy();
    expect(svc.key).toBe(first);
  });

  it('survives a new instance, because it lives in storage', () => {
    const first = TestBed.inject(VisitorService).key;
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    expect(TestBed.inject(VisitorService).key).toBe(first);
  });

  it('gives two browsers different ids', () => {
    const a = TestBed.inject(VisitorService).key;
    localStorage.removeItem('gaadiiq_visitor');
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    expect(TestBed.inject(VisitorService).key).not.toBe(a);
  });

  it('returns null rather than throwing when storage is unavailable', () => {
    // Private browsing, disabled storage, or a quota error. The view still
    // gets recorded; it just cannot be tied to a returning browser.
    spyOn(localStorage, 'getItem').and.throwError('SecurityError');
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    expect(TestBed.inject(VisitorService).key).toBeNull();
  });

  it('is opaque — it carries nothing about the person', () => {
    // Not an assertion a test can fully make, but it can at least catch
    // somebody later deciding to seed this from an email address.
    const key = TestBed.inject(VisitorService).key!;
    expect(key).toMatch(/^[0-9a-f-]+$|^v-[0-9a-z-]+$/i);
    expect(key).not.toContain('@');
  });
});
