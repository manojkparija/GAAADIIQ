# iOS Capacitor Setup (MOB-001)

The iOS Capacitor project must be initialised on a macOS machine with Xcode installed.

## One-time setup (run on Mac)

```bash
cd apps/gaadiiq-angular

# Install Capacitor iOS plugin
npm install @capacitor/ios

# Build Angular first
npm run build

# Add iOS platform
npx cap add ios

# Open in Xcode
npx cap open ios
```

## After each Angular build

```bash
npm run build
npx cap sync ios
npx cap open ios  # then Archive → Upload to App Store Connect
```

## Required Xcode configuration

1. **Bundle ID**: `com.gaadiiq.app`
2. **Team**: Set your Apple Developer Team
3. **Signing**: Enable automatic signing
4. **Info.plist** permissions to add:
   - `NSLocationWhenInUseUsageDescription` — "GAADIIQ needs your location to find nearby service centres"
   - `NSCameraUsageDescription` — "GAADIIQ needs camera access to photograph vehicle issues"
   - `NSPhotoLibraryUsageDescription` — "GAADIIQ needs photo library access to attach vehicle images"
   - `NSMicrophoneUsageDescription` — "GAADIIQ needs microphone access for voice search"

## Push Notifications (APNs)

1. Create APNs key in Apple Developer Portal
2. Configure in Firebase Console under iOS app
3. Capacitor push plugin handles the rest via `@capacitor/push-notifications`

## Network Security (iOS equivalent of MOB-006)

iOS enforces App Transport Security (ATS) by default — no HTTP connections allowed.
Ensure all API endpoints use HTTPS. In development, add to `ios/App/App/Info.plist`:

```xml
<key>NSAppTransportSecurity</key>
<dict>
  <key>NSAllowsLocalNetworking</key>
  <true/>
</dict>
```

This allows `localhost` only — never set `NSAllowsArbitraryLoads: true`.
