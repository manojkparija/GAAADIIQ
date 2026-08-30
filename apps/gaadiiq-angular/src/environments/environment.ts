export const environment = {
  production: false,
  apiUrl: 'http://localhost:8000',
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
    uploadPreset: 'gaadiiq_cars'        // create unsigned preset with this name in Cloudinary
  }
};
