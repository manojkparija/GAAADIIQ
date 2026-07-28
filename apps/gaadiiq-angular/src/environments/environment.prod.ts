export const environment = {
  production: true,
  apiUrl: 'https://gaadiiq-api.onrender.com',
  // Address the dev sign-in shortcut recognises. It only becomes a real,
  // API-capable login if a Supabase user exists with this exact email —
  // otherwise the session is browser-only and every API call is anonymous.
  devAdminEmail: 'manojkparija@gaadiiq.com',
  supabase: {
    url: 'https://gnhixykdvnuoxeccntjo.supabase.co',
    key: 'sb_publishable_K-cu3EbiH3uDIsonlonRmw_tqsKfp_K'
  },
  cloudinary: {
    cloudName: 'zrkacctu',
    uploadPreset: 'gaadiiq_cars'
  }
};
