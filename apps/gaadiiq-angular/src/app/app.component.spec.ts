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
  activateCount = 0;
  constructor(public isEnabled = true) {}
  activateUpdate(): Promise<boolean> {
    this.activateCount++;
    return Promise.resolve(true);
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
  // Stubbed before ngOnInit: a real reload would take the test runner with it.
  spyOn(fixture.componentInstance, 'reloadPage');
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
