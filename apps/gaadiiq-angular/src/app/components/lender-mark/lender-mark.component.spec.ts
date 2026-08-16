/**
 * The lender monogram.
 *
 * The rate table on Car Loan listed eleven lenders as bare text. A symbol per
 * row is what the EMI calculator already had — as emoji, which cannot extend
 * past five banks: there is no emoji for Cholamandalam, and 💳 / 🔵 / 🟠 said
 * nothing about the bank they sat beside.
 *
 * The initials are the whole of the logic, so they are what is tested. The
 * cases below are the real partner names from GET /loans/partners.
 */

import { TestBed } from '@angular/core/testing';

import { LenderMarkComponent, lenderInitials } from './lender-mark.component';

describe('lenderInitials', () => {
  it('keeps a bank that already goes by an acronym', () => {
    // "HD" would be wrong twice over — it is not what anyone calls them, and
    // HDFC Bank and HDB Financial Services would collide on it.
    expect(lenderInitials('HDFC Bank')).toBe('HDFC');
    expect(lenderInitials('HDB Financial Services')).toBe('HDB');
    expect(lenderInitials('ICICI Bank')).toBe('ICICI');
  });

  it('skips words that carry no identity', () => {
    // Otherwise State Bank of India initialises to SBOI and Bank of Baroda to BOB.
    expect(lenderInitials('State Bank of India')).toBe('SBI');
    expect(lenderInitials('Bank of Baroda')).toBe('BB');
  });

  it('initialises an ordinary name, three letters at most', () => {
    expect(lenderInitials('Punjab National Bank')).toBe('PNB');
    expect(lenderInitials('Kotak Mahindra Bank')).toBe('KMB');
    expect(lenderInitials('Maruti Suzuki Finance')).toBe('MSF');
    expect(lenderInitials('Axis Bank')).toBe('AB');
    expect(lenderInitials('Cholamandalam Finance')).toBe('CF');
  });

  it('does not return an empty mark for an empty name', () => {
    expect(lenderInitials('')).toBe('?');
    expect(lenderInitials('   ')).toBe('?');
  });

  it('gives every partner a distinguishable mark', () => {
    // A monogram shared by two rows is no better than the bare text it replaced.
    const partners = [
      'State Bank of India', 'HDFC Bank', 'ICICI Bank', 'Axis Bank',
      'Kotak Mahindra Bank', 'Bank of Baroda', 'Punjab National Bank',
      'Yes Bank', 'Cholamandalam Finance', 'HDB Financial Services',
      'Maruti Suzuki Finance',
    ];
    const marks = partners.map(lenderInitials);
    expect(new Set(marks).size).withContext(`collision in ${marks}`).toBe(partners.length);
  });
});

describe('LenderMarkComponent', () => {
  function render(name: string, logoUrl: string | null = null) {
    const fixture = TestBed.createComponent(LenderMarkComponent);
    fixture.componentInstance.name = name;
    fixture.componentInstance.logoUrl = logoUrl;
    fixture.detectChanges();
    return fixture;
  }

  beforeEach(() => TestBed.configureTestingModule({ imports: [LenderMarkComponent] }));

  it('draws the monogram when the partner has no logo', () => {
    // logo_url is null for every partner today, so this is the case that shows.
    const el = render('Punjab National Bank').nativeElement;
    expect(el.querySelector('.lm-mark').textContent.trim()).toBe('PNB');
    expect(el.querySelector('img')).toBeNull();
  });

  it('prefers a real logo when the API sends one', () => {
    const el = render('HDFC Bank', 'https://example.com/hdfc.png').nativeElement;
    expect(el.querySelector('img').getAttribute('src')).toBe('https://example.com/hdfc.png');
  });

  it('falls back to the monogram if the logo will not load', () => {
    // A broken image would otherwise leave the row with a gap where the mark goes.
    const fixture = render('HDFC Bank', 'https://example.com/gone.png');
    fixture.componentInstance.imageFailed.set(true);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.lm-mark').textContent.trim()).toBe('HDFC');
  });

  it('gives the same lender the same colour every time', () => {
    // The colour is part of telling one row from another; it cannot shuffle
    // between the two pages that draw it, or between visits.
    const first = render('Yes Bank').componentInstance.colours();
    const second = render('Yes Bank').componentInstance.colours();
    expect(first).toEqual(second);
  });

  it('paints an opaque background rather than a tint of the ink', () => {
    // The first version tinted at 12% opacity, which let the panel behind show
    // through: the same mark measured 4.9:1 on the white Car Loan card and
    // 3.97:1 on the EMI calculator's glass one, passing on one page and failing
    // AA on the other. A badge has to carry its own background with it.
    const el = render('State Bank of India').nativeElement.querySelector('.lm-mark');
    const bg = getComputedStyle(el).backgroundColor;
    expect(bg).withContext(`translucent background ${bg}`).not.toMatch(/rgba|transparent/);
  });

  it('shrinks the type for a five-letter acronym rather than the box', () => {
    // ICICI at full size overflows, and a wider box breaks the row alignment.
    const el = render('ICICI Bank').nativeElement;
    expect(el.querySelector('.lm-mark').classList).toContain('lm-long');
    expect(render('Axis Bank').nativeElement.querySelector('.lm-mark').classList)
      .not.toContain('lm-long');
  });
});
