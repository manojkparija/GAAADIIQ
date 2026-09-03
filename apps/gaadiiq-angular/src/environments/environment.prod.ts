export const environment = {
  production: true,
  // The API on our own domain, so requests reach Render through Cloudflare
  // rather than going straight at the origin. gaadiiq-api.onrender.com still
  // works and still answers; the point is that nothing we ship addresses it,
  // which is what lets the origin lock and the Render IP restriction close it
  // to everyone else.
  //
  // ROLLBACK, if api.gaadiiq.com ever misbehaves: set that DNS record to
  // grey-cloud (DNS only) in Cloudflare. It stays a CNAME to the same Render
  // service, so the app keeps working and simply stops passing through the
  // proxy — no code change, no APK rebuild, effective in a minute. That is
  // why this is a plain constant rather than something switchable at runtime:
  // the switch that matters is in DNS, not in the bundle.
  apiUrl: 'https://api.gaadiiq.com',
  // Address the dev sign-in shortcut recognises. It only becomes a real,
  // API-capable login if a Supabase user exists with this exact email —
  // otherwise the session is browser-only and every API call is anonymous.
  devAdminEmail: 'manojkparija@gaadiiq.com',
  // Emails shown the admin screens. Keep in step with the API's ADMIN_EMAILS —
  // this only decides what the UI offers; the server decides what it allows.
  adminEmails: ['manojkparija@gaadiiq.com'],

  // Google Maps JavaScript API.
  //
  // PUBLIC BY DESIGN, unlike every other credential in this project. A Maps JS
  // key is loaded by the browser and is therefore readable in the page source —
  // that is unavoidable, not an oversight, and it is why this one lives here
  // rather than in Render's environment alongside OCM_API_KEY and the APITube
  // key.
  //
  // What protects it is the restriction, not the secrecy: the key is limited to
  // the Maps JavaScript API alone and to four referrers (this app's Vercel
  // hosts, gaadiiq.com and localhost:4200). If the map ever fails with
  // RefererNotAllowedMapError, a new deployment URL needs adding there — the
  // code is not the problem.
  googleMapsApiKey: 'AIzaSyDKQwqMc8DGIHoia5QYmAnHaPBc8q0FOeI',
  // Whether the app may ask Android for a push token.
  //
  // Off until google-services.json exists in the Android project. Without it
  // Firebase is not initialised, and PushNotifications.register() throws
  // IllegalStateException on Android's own Handler thread — which kills the
  // process before any promise can reject. The .catch() at the call site could
  // never have caught it.
  //
  // Measured: the installed debug APK died on launch with
  //   java.lang.IllegalStateException: Default FirebaseApp is not initialized
  //   in this process com.gaadiiq.app
  //   at com.capacitorjs.plugins.pushnotifications.PushNotificationsPlugin.register
  //
  // Turn this on in the same change that adds google-services.json, not before.
  pushEnabled: false,
  supabase: {
    url: 'https://gnhixykdvnuoxeccntjo.supabase.co',
    key: 'sb_publishable_K-cu3EbiH3uDIsonlonRmw_tqsKfp_K'
  },
  cloudinary: {
    cloudName: 'zrkacctu',
    uploadPreset: 'gaadiiq_cars'
  }
};
