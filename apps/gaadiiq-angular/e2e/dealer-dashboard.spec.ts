/**
 * Dealer Dashboard — end to end, against the built app with no backend.
 *
 * WHY THE MOCKING, AND WHY IT IS NOT CHEATING
 *
 * CI starts no API (ci-web.yml runs the built bundle behind a static server),
 * and the dashboard is behind sellerGuard, which needs a Supabase session with
 * a seller role. A spec that needed a live backend would have to skip in CI —
 * and a spec that always skips reports nothing while looking exactly like a
 * passing one, which is the failure mode CLAUDE.md warns about for testMatch.
 *
 * So the network is stubbed at the edge and everything inside it is real: the
 * real guard, the real component, the real signals and computeds, the real
 * template. What is faked is only what crosses the wire. That makes these tests
 * deterministic and able to cover paths a live API makes hard to reach on
 * demand — a 403 lead inbox, a failed status write, an empty dashboard.
 *
 * WHAT THIS CANNOT TELL YOU
 *
 * Nothing about whether the API returns these shapes. The fixtures below are
 * asserted against the TypeScript interfaces the services declare, not against
 * the server. If the API changes shape, these tests keep passing and the page
 * breaks — that gap is covered by the API's own suite, not here.
 */
import { test, expect, Page } from '@playwright/test';

const SUPABASE_REF = 'gnhixykdvnuoxeccntjo';
const SELLER_EMAIL = 'dealer@gaadiiq.test';

/** A session supabase-js will accept from storage without a refresh round trip. */
function sessionFor(email: string) {
  const farFuture = Math.floor(Date.now() / 1000) + 60 * 60 * 24;
  return {
    access_token: 'e2e-fake-access-token',
    token_type: 'bearer',
    expires_in: 86400,
    expires_at: farFuture,
    refresh_token: 'e2e-fake-refresh-token',
    user: {
      id: '00000000-0000-4000-8000-000000000001',
      aud: 'authenticated',
      role: 'authenticated',
      email,
      app_metadata: {},
      user_metadata: {},
      created_at: new Date().toISOString(),
    },
  };
}

type Fixtures = {
  /** What user_profiles returns — this is what decides the guard's answer. */
  profile?: { role: string; seller_id: number | null; name: string } | null;
  /** The sellers row. business_name is nullable in the database. */
  seller?: Record<string, unknown> | null;
  leadsStatus?: number;
  leads?: unknown[];
  /** Status returned by PATCH /leads/{id} — 500 exercises the rollback path. */
  leadPatchStatus?: number;
  testDrives?: unknown[];
  enquiries?: unknown[];
  sentimentLeads?: unknown[];
};

/**
 * Put the page in a signed-in state and answer every network call it makes.
 *
 * Routes are registered before navigation so nothing escapes to the real
 * Supabase or the real API — a test that silently reached production would be
 * both slow and a data-integrity problem.
 */
async function arrive(page: Page, path: string, f: Fixtures = {}) {
  const {
    profile = { role: 'seller', seller_id: 1, name: 'Test Dealer' },
    seller = {
      id: 1, name: 'R Kumar', business_name: 'RK Motors', phone: '9876543210',
      email: SELLER_EMAIL, city: 'Kolkata', address: '12 GT Road',
      verified: true, rating: 4.5, total_reviews: 12,
    },
    leadsStatus = 200,
    leads = [],
    leadPatchStatus = 200,
    testDrives = [],
    enquiries = [],
    sentimentLeads = [],
  } = f;

  if (profile !== null) {
    await page.addInitScript(
      ([ref, session]) => {
        window.localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(session));
      },
      [SUPABASE_REF, sessionFor(SELLER_EMAIL)] as const,
    );
  }

  /*
   * Supabase auth. The SHAPE per endpoint matters, and getting it wrong is why
   * this suite passed locally and failed in CI on its first push.
   *
   * /auth/v1/user returns a User; /auth/v1/token returns a Session (a User
   * wrapped in tokens). Answering both with a Session made supabase-js reject
   * the /user response and drop the session, so currentUser went null and the
   * guard sent every affected test somewhere else.
   *
   * It only showed up in CI because this sandbox blocks outbound requests: the
   * call failed at the network layer, supabase-js kept the stored session, and
   * the wrong stub was never reached. A CI runner has real egress, reaches the
   * route, and gets the wrong body. "Passes locally" was evidence about the
   * sandbox, not about the test.
   */
  await page.route('**/auth/v1/**', route => {
    const session = sessionFor(SELLER_EMAIL);
    const path = new URL(route.request().url()).pathname;
    const body = path.endsWith('/user') ? session.user : session;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });

  // PostgREST. maybeSingle() asks for a single object, so tables read that way
  // return an object; the rest return arrays.
  await page.route('**/rest/v1/**', route => {
    const url = route.request().url();
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

    if (url.includes('/user_profiles')) return json(profile);
    if (url.includes('/sellers')) return json(seller);
    if (url.includes('/test_drive_requests')) return json(testDrives);
    if (url.includes('/car_enquiries')) return json(enquiries);
    // The dashboard scopes enquiries to this seller's listings; one row is
    // enough for the `ids.length === 0` early return not to fire.
    if (url.includes('/car_listings')) return json([{ id: 'listing-1' }]);
    // Everything else the dashboard reads: test_drive_requests, car_listings,
    // car_seller_map, cars. Answered as empty rather than left to escape —
    // an unrouted request goes to the real Supabase, which is slow and wrong.
    return json([]);
  });

  /*
   * One handler for the whole API host, switching on the exact pathname.
   *
   * Separate page.route globs were a trap: a glob ending in "leads" also
   * matches the sentiment feed's own leads path, so the sentiment panel was
   * handed car-lead objects —
   * wrong shape, no intent_score — and the dashboard failed to render at all
   * while the lead fixtures looked perfectly correct. Which glob wins depends
   * on registration order, which is not something a reader of this file should
   * have to reason about.
   */
  await page.route('**://api.gaadiiq.com/**', route => {
    const path = new URL(route.request().url()).pathname;
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

    if (path === '/leads') {
      return json(leadsStatus === 200 ? leads : { detail: 'Not a dealer' }, leadsStatus);
    }
    if (path.startsWith('/leads/')) {
      return json(leadPatchStatus === 200 ? { ok: true } : { detail: 'nope' }, leadPatchStatus);
    }
    if (path === '/sentiment/leads') return json(sentimentLeads);
    if (path === '/sentiment/summary') return json({});
    // The catalogue calls the shell makes on every page. Answered so they do
    // not escape to the real API and time out, which added ~20s per test.
    return json({ items: [], total: 0, page: 1, page_size: 100 });
  });

  /*
   * Straight to the route under test.
   *
   * Visiting a public page first to "warm up" the auth state was tried and
   * removed: page.goto is a full document navigation, so the second goto reboots
   * the Angular app and re-runs the same hydration race from scratch. It bought
   * nothing and cost every test an extra page load. The guard's own redirect,
   * asserted below, is what tells us whether hydration won.
   */
  await page.goto(path);
}

/** Wait for the leads panel to have decided what it is showing. */
async function leadsSettled(page: Page) {
  // All three branches — rows, empty state, error — are gated on this being
  // false. Asserting before it clears means asserting against a spinner.
  await expect(page.getByText('Loading leads…')).toHaveCount(0, { timeout: 20_000 });
}

// ── The guard ────────────────────────────────────────────────────────────────
//
// The dashboard's first job is to not be reachable. These run without the
// session seeding, so they exercise the real anonymous path.

test.describe('reaching the dashboard', () => {
  test('an anonymous visitor is sent to login, keeping their destination', async ({ page }) => {
    await page.goto('/dealer-dashboard');
    await page.waitForURL(/\/login/, { timeout: 15_000 });

    // returnUrl is the point: without it, signing in drops the dealer on the
    // home page and they have to find the dashboard again.
    expect(page.url()).toContain('returnUrl');
    expect(decodeURIComponent(page.url())).toContain('dealer-dashboard');
  });

  test('a signed-in customer is turned away rather than shown an empty dashboard', async ({ page }) => {
    await arrive(page, '/dealer-dashboard', {
      profile: { role: 'user', seller_id: null, name: 'A Buyer' },
    });

    await page.waitForURL(url => !url.pathname.includes('dealer-dashboard'), { timeout: 15_000 });
    expect(page.url()).toContain('accessDenied');
  });

  test('a seller is let through', async ({ page }) => {
    await arrive(page, '/dealer-dashboard');

    await expect(page).toHaveURL(/dealer-dashboard/);
    // Something of the dashboard itself must render — reaching the URL is not
    // the same as the page working, and a blank page would pass a URL check.
    await expect(page.locator('body')).not.toBeEmpty();
  });
});

// ── The page itself ──────────────────────────────────────────────────────────

test.describe('the dashboard a seller sees', () => {
  test('renders its own heading, not just a URL', async ({ page }) => {
    await arrive(page, '/dealer-dashboard');
    await expect(page.getByRole('heading', { name: /Dealer Dashboard/i })).toBeVisible();
  });

  test('offers every tab the dealer works from', async ({ page }) => {
    await arrive(page, '/dealer-dashboard');
    for (const label of [/Overview/, /AI Leads/, /Inventory/, /Analytics/, /Test Drive/, /Enquiries/, /Leads/]) {
      await expect(page.locator('.dd-tab', { hasText: label }).first()).toBeVisible();
    }
  });

  test('switching tabs changes what is shown', async ({ page }) => {
    await arrive(page, '/dealer-dashboard');
    const tab = page.locator('.dd-tab', { hasText: /New Car Leads|🚗/ }).first();
    await tab.click();
    await expect(page.getByRole('heading', { name: /New Car Leads/i })).toBeVisible();
  });
});

// ── The distinction the code goes out of its way to make ─────────────────────
//
// "You have no leads" and "we could not fetch your leads" look identical if
// both render an empty list, and one of them means a dealer is not calling
// people who are waiting. The component has separate branches for these; these
// tests are what stop the two collapsing back into one.

test.describe('an empty lead inbox versus a broken one', () => {
  async function openCarLeads(page: Page) {
    await page.locator('.dd-tab', { hasText: /🚗/ }).first().click();
    await leadsSettled(page);
  }

  test('no leads says so, and says it is not an error', async ({ page }) => {
    await arrive(page, '/dealer-dashboard', { leads: [] });
    await openCarLeads(page);

    await expect(page.getByText(/No new-car leads yet/i)).toBeVisible();
    await expect(page.getByText(/This is not the same as having no leads/i)).toHaveCount(0);
  });

  test('a 403 names the actual cause rather than blaming the network', async ({ page }) => {
    // 403 here is a real answer — the account is not a dealer — not a fault.
    // "Could not load" would send someone hunting a bug that does not exist.
    await arrive(page, '/dealer-dashboard', { leadsStatus: 403 });
    await openCarLeads(page);

    await expect(page.getByText(/not registered as a dealer/i)).toBeVisible();
    await expect(page.getByText(/This is not the same as having no leads/i)).toBeVisible();
    await expect(page.getByText(/No new-car leads yet/i)).toHaveCount(0);
  });

  test('leads that do arrive are listed with the buyer reachable', async ({ page }) => {
    await arrive(page, '/dealer-dashboard', {
      leads: [{
        id: 'l1', name: 'Priya Sen', phone: '9876543210',
        make: 'Maruti Suzuki', model: 'Fronx', variant: 'Alpha AT',
        city: 'Kolkata', locality: 'Salt Lake', status: 'new',
        created_at: new Date().toISOString(),
      }],
    });
    await openCarLeads(page);

    // Scoped to the lead cell: the dealer's own name also appears in the
    // header, and an unscoped match would pass on the wrong element.
    await expect(page.locator('.lt-name', { hasText: 'Priya Sen' })).toBeVisible();
    // The phone must be a tel: link. A dealer's whole job on this screen is to
    // ring the person, and on a phone a plain number is not tappable.
    await expect(page.locator('a[href="tel:9876543210"]')).toBeVisible();
    await expect(page.getByText(/Fronx/)).toBeVisible();
  });
});

// ── Test drives: the empty state that used to accuse the wrong thing ─────────

test.describe('test drive requests when there are none', () => {
  test('a seller with no dealer profile is told what is missing', async ({ page }) => {
    // seller_id null and no sellers row → the page cannot group requests.
    await arrive(page, '/dealer-dashboard', {
      profile: { role: 'seller', seller_id: null, name: 'Unlinked Dealer' },
      // No sellers row either — that is what "not linked" means. Returning a
      // seller here while claiming the profile has none was the fixture
      // contradicting itself, and the page correctly ignored the claim.
      seller: null,
      testDrives: [],
    });
    await page.locator('.dd-tab', { hasText: /Test Drive/ }).first().click();

    await expect(page.getByText(/isn't linked to a dealer profile/i)).toBeVisible();
  });
});

// ── Data the type system promises but the database does not ──────────────────

test.describe('a seller record with fields the database left null', () => {
  /**
   * Seller.business_name and AuthUser.name are both typed as plain strings, so
   * TypeScript is satisfied — but they come from Supabase, where a nullable
   * column tells the compiler nothing. The initials computeds split them.
   *
   * Found by getting a fixture wrong while writing these tests: the console
   * filled with "Cannot read properties of undefined (reading 'split')",
   * repeating, because a throwing computed() is re-evaluated on every change
   * detection cycle. The fallback the code already had ('??') was unreachable.
   */
  test('renders with initials fallbacks instead of throwing on every cycle', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(String(e)));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

    await arrive(page, '/dealer-dashboard', {
      seller: { id: 1, business_name: null, name: null, email: SELLER_EMAIL, city: 'Kolkata' },
    });

    await expect(page.getByRole('heading', { name: /Dealer Dashboard/i })).toBeVisible();
    // Give change detection several cycles to repeat the fault if it is back.
    await page.waitForTimeout(1500);

    const splitErrors = errors.filter(e => /reading 'split'/.test(e));
    expect(splitErrors, `initials threw on a null name:\n${splitErrors.slice(0, 3).join('\n')}`).toHaveLength(0);

    // NG0600 is "writing to a signal inside a computed". It is asserted here
    // rather than in its own test because this is the page's error-watching
    // test and the check is free: a computed that writes is a defect whatever
    // triggered it, and one appeared in the console while this suite was being
    // built. If it returns, this is where it surfaces.
    const ng0600 = errors.filter(e => /NG0600/.test(e));
    expect(ng0600, `a computed wrote to a signal:\n${ng0600.slice(0, 2).join('\n')}`).toHaveLength(0);
  });

  test('a lead with no name still renders a row', async ({ page }) => {
    // The lead table already shows "Not given" for a missing name — the buyer
    // is allowed to leave it blank — so the avatar beside it must cope too.
    await arrive(page, '/dealer-dashboard', {
      leads: [{
        id: 'l1', name: null, phone: '9800000000',
        make: 'Maruti Suzuki', model: 'Fronx', city: 'Kolkata',
        status: 'new', created_at: new Date().toISOString(),
      }],
    });
    await page.locator('.dd-tab', { hasText: /🚗/ }).first().click();
    await leadsSettled(page);

    await expect(page.getByText('Not given')).toBeVisible();
    await expect(page.locator('a[href="tel:9800000000"]')).toBeVisible();
  });
});

// ── Writing a lead status, and putting it back when the write fails ──────────

test.describe('changing a lead status', () => {
  const lead = (over: Record<string, unknown> = {}) => ({
    id: 'l1', name: 'Priya Sen', phone: '9876543210',
    make: 'Maruti Suzuki', model: 'Fronx', variant: null,
    city: 'Kolkata', locality: null, pincode: null, phone_verified: true,
    email: null, consented_at: null, source: 'web',
    status: 'new', created_at: new Date().toISOString(),
    ...over,
  });

  async function openCarLeads(page: Page) {
    await page.locator('.dd-tab', { hasText: /🚗/ }).first().click();
    await leadsSettled(page);
  }

  test('a successful write keeps the new status', async ({ page }) => {
    await arrive(page, '/dealer-dashboard', { leads: [lead()] });
    await openCarLeads(page);

    const select = page.locator('select.lead-status').first();
    await expect(select).toHaveValue('new');
    await select.selectOption('contacted');

    await expect(select).toHaveValue('contacted');
    await expect(page.getByText(/Could not save that status/i)).toHaveCount(0);
  });

  test('a failed write puts the old status back and says so', async ({ page }) => {
    /*
     * The rollback is the half worth testing. The optimistic update is visible
     * the moment you click; the revert only happens when something else has
     * already gone wrong, which is exactly when nobody is looking.
     *
     * The comment in setLeadStatus says why it matters: "a status that silently
     * reverts on the next load is how a dealer loses track of who they have
     * called." Without the message, the row would flick back with no
     * explanation and the dealer would believe the save worked.
     */
    await arrive(page, '/dealer-dashboard', { leads: [lead()], leadPatchStatus: 500 });
    await openCarLeads(page);

    const select = page.locator('select.lead-status').first();
    await select.selectOption('contacted');

    await expect(select).toHaveValue('new');
    await expect(page.getByText(/Could not save that status. It has been put back/i)).toBeVisible();
  });

  test('re-selecting the status already set does not write at all', async ({ page }) => {
    // setLeadStatus returns early when the status has not changed. Asserted by
    // failing every write: if one were issued, the error banner would appear.
    await arrive(page, '/dealer-dashboard', { leads: [lead()], leadPatchStatus: 500 });
    await openCarLeads(page);

    await page.locator('select.lead-status').first().selectOption('new');

    await expect(page.getByText(/Could not save that status/i)).toHaveCount(0);
  });
});

// ── Test drive conversion: null is not zero ──────────────────────────────────

test.describe('test drive conversion rate', () => {
  const drive = (over: Record<string, unknown> = {}) => ({
    id: 1, car_id: 'c1', car_make: 'Maruti Suzuki', car_model: 'Fronx', car_year: 2026,
    buyer_name: 'A Buyer', buyer_phone: '9800000000',
    preferred_date: '2026-09-10', preferred_time: '11:00',
    seller_id: 1, status: 'Pending', outcome: null,
    created_at: new Date().toISOString(),
    ...over,
  });

  async function openTestDrives(page: Page) {
    await page.locator('.dd-tab', { hasText: /Test Drive/ }).first().click();
  }

  test('says there is nothing to measure rather than showing 0%', async ({ page }) => {
    /*
     * testDriveConversion returns null when no drive is Completed, and the
     * template renders a sentence instead of a percentage. 0% would be a claim
     * — that every completed drive was lost — about drives that have not
     * happened. A dealer with three pending bookings has not lost anything.
     */
    await arrive(page, '/dealer-dashboard', { testDrives: [drive(), drive({ id: 2 })] });
    await openTestDrives(page);

    await expect(page.getByText(/No completed test drives yet/i)).toBeVisible();
    await expect(page.locator('.td-conversion')).not.toContainText('0%');
  });

  test('measures over completed drives only, not over every request', async ({ page }) => {
    // One Won, one Lost, one still Pending. The pending request must not count
    // against the rate — 50%, not 33%.
    await arrive(page, '/dealer-dashboard', {
      testDrives: [
        drive({ id: 1, status: 'Completed', outcome: 'Won' }),
        drive({ id: 2, status: 'Completed', outcome: 'Lost' }),
        drive({ id: 3, status: 'Pending' }),
      ],
    });
    await openTestDrives(page);

    await expect(page.locator('.td-conversion')).toContainText('50%');
    await expect(page.locator('.td-conversion')).toContainText('1 of 2');
  });
});

// ── AI Leads grade filters ───────────────────────────────────────────────────

test.describe('filtering AI leads by grade', () => {
  const scored = (id: string, grade: string, score: number, name: string) => ({
    id, lead_id: id, lead_grade: grade, intent_score: score,
    // The template renders customer_name; buyer_name is a different feed's
    // field and rendered nothing at all when used here.
    customer_name: name, phone: '9800000000',
    car_make: 'Maruti Suzuki', car_model: 'Fronx',
    total_enquiries: 1, created_at: new Date().toISOString(),
    summary: '', signals: [],
  });

  const FIXTURE = [
    scored('a1', 'A', 92, 'Hot Buyer'),
    scored('b1', 'B', 70, 'Warm Buyer'),
    scored('d1', 'D', 12, 'Cold Buyer'),
  ];

  test('All shows every grade; picking a grade narrows to it', async ({ page }) => {
    await arrive(page, '/dealer-dashboard', { sentimentLeads: FIXTURE });
    await page.locator('.dd-tab', { hasText: /AI Leads/ }).first().click();

    await expect(page.getByText('Hot Buyer')).toBeVisible();
    await expect(page.getByText('Cold Buyer')).toBeVisible();

    await page.locator('.gf-btn.gf-a').click();
    await expect(page.getByText('Hot Buyer')).toBeVisible();
    await expect(page.getByText('Cold Buyer')).toHaveCount(0);

    await page.locator('.gf-btn', { hasText: /^All$/ }).first().click();
    await expect(page.getByText('Cold Buyer')).toBeVisible();
  });

  test('an overview chip jumps to the tab already filtered', async ({ page }) => {
    // The chip does two things in one click — switch tab AND set the filter.
    // Landing on an unfiltered list would look like the chip did nothing.
    await arrive(page, '/dealer-dashboard', { sentimentLeads: FIXTURE });

    await page.locator('.ai-sum-chip.hot').click();

    await expect(page.locator('.gf-btn.gf-a')).toHaveClass(/active/);
    await expect(page.getByText('Hot Buyer')).toBeVisible();
    await expect(page.getByText('Cold Buyer')).toHaveCount(0);
  });
});

// ── Buyer enquiries ──────────────────────────────────────────────────────────

test.describe('buyer enquiries', () => {
  test('an empty inbox says so plainly', async ({ page }) => {
    await arrive(page, '/dealer-dashboard', { enquiries: [] });
    await page.locator('.dd-tab', { hasText: /Enquiries/ }).first().click();

    await expect(page.getByText(/No enquiries yet/i)).toBeVisible();
  });
});
