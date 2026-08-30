/**
 * The app does not ask Android for a push token it cannot get.
 *
 * Reported from an installed debug APK: "GAADIIQ keeps stopping", on every
 * launch, before a frame was drawn. The crash report said
 *
 *   java.lang.IllegalStateException: Default FirebaseApp is not initialized
 *   in this process com.gaadiiq.app. Make sure to call
 *   FirebaseApp.initializeApp(Context) first.
 *     at com.google.firebase.messaging.FirebaseMessaging.getInstance
 *     at com.capacitorjs.plugins.pushnotifications.PushNotificationsPlugin.register
 *
 * google-services.json is absent, so Firebase is never initialised, and
 * register() throws.
 *
 * THE CATCH WAS NOT A GUARD
 *
 * The call site read
 *
 *     this.native.registerPush().catch(() => {  non-fatal  });
 *
 * and the comment was wrong. The exception is raised inside the native plugin
 * on Android's own Handler thread, so it never becomes a rejected promise —
 * the process is gone before JavaScript hears anything. A promise-level catch
 * cannot catch a native crash, which is why the app died despite looking
 * defended.
 *
 * So the call is avoided rather than caught, behind a flag that goes on in the
 * same change that adds google-services.json.
 *
 * Nothing here affects the website: the whole block is inside `if
 * (this.native.isNative)`.
 */
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { SwUpdate } from '@angular/service-worker';
import { of } from 'rxjs';

import { AppComponent } from './app.component';
import { NativeService } from './services/native.service';
import { environment } from '../environments/environment';

function mount(isNative: boolean) {
  TestBed.resetTestingModule();
  const native = {
    isNative,
    registerPush: jasmine.createSpy('registerPush').and.resolveTo(null),
    isRootedOrJailbroken: jasmine.createSpy('isRootedOrJailbroken').and.resolveTo(false),
    hideSplash: jasmine.createSpy('hideSplash').and.resolveTo(undefined),
    setStatusBar: jasmine.createSpy('setStatusBar').and.resolveTo(undefined),
  };
  TestBed.configureTestingModule({
    imports: [AppComponent, RouterTestingModule],
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: NativeService, useValue: native },
      { provide: SwUpdate, useValue: { isEnabled: false, versionUpdates: of() } },
    ],
  });
  const c = TestBed.createComponent(AppComponent).componentInstance as any;
  return { c, native };
}

describe('AppComponent — asking Android for a push token', () => {
  const original = environment.pushEnabled;
  afterEach(() => { (environment as any).pushEnabled = original; });

  it('does not register while push is unconfigured', () => {
    // The reported crash. register() must not be reached at all — catching it
    // afterwards is impossible, the process is already gone.
    (environment as any).pushEnabled = false;
    const { c, native } = mount(true);

    c.ngOnInit();

    expect(native.registerPush).not.toHaveBeenCalled();
  });

  it('registers once push is configured', () => {
    // The flag turns on with google-services.json. If this did not pass, the
    // guard would have quietly removed the feature rather than deferred it.
    (environment as any).pushEnabled = true;
    const { c, native } = mount(true);

    c.ngOnInit();

    expect(native.registerPush).toHaveBeenCalled();
  });

  it('never registers in a browser, configured or not', () => {
    // The whole block is native-only; the website has no Capacitor bridge.
    (environment as any).pushEnabled = true;
    const { c, native } = mount(false);

    c.ngOnInit();

    expect(native.registerPush).not.toHaveBeenCalled();
  });

  it('ships with the flag off', () => {
    // The default is what the built APK carries. On by default would put the
    // crash straight back for anyone who has not added google-services.json.
    expect(original).toBeFalse();
  });
});
