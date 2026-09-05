import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { SwUpdate, VersionEvent } from '@angular/service-worker';
import { Subject } from 'rxjs';
import { AppComponent } from './app.component';

/**
 * A stand-in for the service worker, so the update path can be driven without
 * one. `isEnabled` false is what a browser without service-worker support
 * reports, and the component must not touch the rest in that state.
 */
class SwUpdateStub {
  versionUpdates = new Subject<VersionEvent>();
  // The event Angular emits when the cached version is broken beyond repair.
  // It has no payload worth modelling; what matters is that it fires.
  unrecoverable = new Subject<{ reason: string }>();
  activateCount = 0;
  checkCount = 0;
  constructor(public isEnabled = true) {}
  activateUpdate(): Promise<boolean> {
    this.activateCount++;
    return Promise.resolve(true);
  }
  checkForUpdate(): Promise<boolean> {
    this.checkCount++;
    return Promise.resolve(false);
  }
}

function createApp(swUpdate: SwUpdateStub) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [AppComponent],
    providers: [
      // AppComponent renders the chat widget: ChatService → DiagnosisService → HttpClient.
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([]),
      { provide: SwUpdate, useValue: swUpdate },
    ],
  });
  const fixture = TestBed.createComponent(AppComponent);
  // Stubbed before ngOnInit: a real reload would take the test runner with it,
  // and a real unregister would tear down Karma's own service worker.
  spyOn(fixture.componentInstance, 'reloadPage');
  spyOn(fixture.componentInstance, 'unregisterServiceWorker').and.resolveTo();
  // The recovery guard is one-shot per tab, and Karma runs every spec in the
  // same tab. Without this, only the first recovery test would see a reload.
  sessionStorage.removeItem('gaadiiq.sw-recovered');
  fixture.detectChanges();  // runs ngOnInit
  return fixture;
}

describe('AppComponent', () => {
  it('should create the app', () => {
    const fixture = createApp(new SwUpdateStub());
    expect(fixture.componentInstance).toBeTruthy();
  });
});

/**
 * This is a PWA: the service worker serves index.html and the bundles from
 * cache, so a browser keeps running the version it installed. Nothing listened
 * for a newer one, so a deployment reached a returning visitor only by
 * accident — and that failure is invisible. It looks exactly like a broken
 * feature: a car that is uploaded, priced and returned by the API is simply
 * not on the page, because the page being run predates the code that asks for
 * it.
 */
describe('AppComponent — picking up a new deployment', () => {
  it('activates a version once the service worker has it ready', async () => {
    const sw = new SwUpdateStub();
    const fixture = createApp(sw);

    sw.versionUpdates.next({
      type: 'VERSION_READY',
      currentVersion: { hash: 'old' },
      latestVersion: { hash: 'new' },
    } as VersionEvent);
    await Promise.resolve();

    expect(sw.activateCount).withContext('a ready version must be taken').toBe(1);
    expect(fixture.componentInstance.reloadPage)
      .withContext('activation only swaps the cache — a reload runs the new code')
      .toHaveBeenCalled();
  });

  it('ignores a version that is only being fetched', () => {
    const sw = new SwUpdateStub();
    createApp(sw);

    sw.versionUpdates.next({
      type: 'VERSION_DETECTED',
      version: { hash: 'new' },
    } as VersionEvent);

    expect(sw.activateCount)
      .withContext('activating before the files are cached would reload into a half-fetched app')
      .toBe(0);
  });

  it('does nothing where service workers are unavailable', () => {
    const sw = new SwUpdateStub(false);
    createApp(sw);

    sw.versionUpdates.next({ type: 'VERSION_READY' } as VersionEvent);

    expect(sw.activateCount).toBe(0);
  });
});

/**
 * THE HARD-REFRESH BUG.
 *
 * Reported from the live site as: "why do I need to go for hard refresh on a
 * regular basis — in production this will not work out."
 *
 * Vercel serves content-hashed bundles and deletes the previous build's files
 * on deploy. A tab still running build A holds a service-worker manifest
 * naming A's hashes; the moment it needs a file it did not prefetch (a lazy
 * route chunk, or anything in the lazy `assets` group — the brand logos) it
 * fetches, gets a 404 from a build that no longer exists, and ngsw marks the
 * client UNRECOVERABLE. From then on the worker neither serves nor repairs
 * itself.
 *
 * That is what was reported twice as separate bugs: brand logos rendering as
 * empty placeholders, and "the catalogue is unreachable" on a car page. The
 * API and the images were fine.
 *
 * Angular emits `SwUpdate.unrecoverable` for exactly this and nothing
 * subscribed, so the app had no way out — which is why the only thing that
 * worked was a hard refresh, the one reload that bypasses the worker.
 */
describe('AppComponent — recovering from a cache the worker cannot repair', () => {
  it('unregisters the worker and reloads when the cache is unrecoverable', async () => {
    const sw = new SwUpdateStub();
    const fixture = createApp(sw);
    const app = fixture.componentInstance;

    sw.unrecoverable.next({ reason: 'Hash mismatch for /main.abc123.js' });
    await Promise.resolve();
    await Promise.resolve();

    expect(app.unregisterServiceWorker)
      .withContext('a plain reload is answered by the same broken worker — it has to go first')
      .toHaveBeenCalled();
    expect(app.reloadPage).toHaveBeenCalled();
  });

  it('recovers when a new version cannot be installed either', async () => {
    // Same dead end reached one step earlier: the worker tried to cache the
    // new build, a fetch 404'd, and it stays on a manifest whose files are gone.
    const sw = new SwUpdateStub();
    const fixture = createApp(sw);

    sw.versionUpdates.next({
      type: 'VERSION_INSTALLATION_FAILED',
      version: { hash: 'new' },
      error: '404',
    } as unknown as VersionEvent);
    await Promise.resolve();
    await Promise.resolve();

    expect(fixture.componentInstance.unregisterServiceWorker).toHaveBeenCalled();
    expect(fixture.componentInstance.reloadPage).toHaveBeenCalled();
  });

  it('recovers at most once per tab', async () => {
    // If the reload lands in the same state, looping is worse than the bug:
    // a page that reloads forever can never be read, used or reported.
    const sw = new SwUpdateStub();
    const fixture = createApp(sw);

    sw.unrecoverable.next({ reason: 'first' });
    await Promise.resolve();
    await Promise.resolve();
    sw.unrecoverable.next({ reason: 'second' });
    await Promise.resolve();
    await Promise.resolve();

    expect(fixture.componentInstance.reloadPage).toHaveBeenCalledTimes(1);
  });

  it('does nothing where service workers are unavailable', () => {
    const sw = new SwUpdateStub(false);
    const fixture = createApp(sw);

    sw.unrecoverable.next({ reason: 'ignored' });

    expect(fixture.componentInstance.reloadPage).not.toHaveBeenCalled();
  });
});

/**
 * A tab left open for days never re-registers the worker, so it never learns a
 * deploy happened. Polling is what turns a deploy into the VERSION_READY the
 * update path already knows how to take, instead of waiting for the tab to be
 * closed and reopened.
 */
describe('AppComponent — noticing deploys in a long-lived tab', () => {
  it('checks for a new version on a timer', () => {
    jasmine.clock().install();
    try {
      const sw = new SwUpdateStub();
      createApp(sw);
      expect(sw.checkCount).withContext('the check is on a timer, not on init').toBe(0);

      jasmine.clock().tick(30 * 60 * 1000 + 1);

      expect(sw.checkCount).toBe(1);
    } finally {
      jasmine.clock().uninstall();
    }
  });

  it('starts no timer where service workers are unavailable', () => {
    jasmine.clock().install();
    try {
      const sw = new SwUpdateStub(false);
      createApp(sw);
      jasmine.clock().tick(30 * 60 * 1000 + 1);
      expect(sw.checkCount).toBe(0);
    } finally {
      jasmine.clock().uninstall();
    }
  });
});
