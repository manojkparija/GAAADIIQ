import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.gaadiiq.app',
  appName: 'GAADIIQ',
  webDir: 'dist/gaadiiq-angular/browser',
  android: {
    buildOptions: {
      keystorePath: undefined,
      keystorePassword: undefined,
      keystoreAlias: undefined,
      keystoreAliasPassword: undefined,
    },
  },
  server: {
    androidScheme: 'https',
  },
  plugins: {
    Camera: {
      // Prompt user for camera & photo library access
      promptLabelHeader: 'GAADIIQ needs photo access',
      promptLabelCancel: 'Cancel',
      promptLabelPhoto: 'Choose from Library',
      promptLabelPicture: 'Take Photo',
    },
    Geolocation: {
      // Uses ACCESS_FINE_LOCATION declared in AndroidManifest
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
    LocalNotifications: {
      smallIcon: 'ic_stat_icon_config_sample',
      iconColor: '#2F6BFF',
    },
  },
};

export default config;
