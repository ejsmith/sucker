# App Store Release Checklist

This checklist is for publishing Sucker! to the Apple App Store through EAS
Build and App Store Connect.

## Repo Configuration

- App name: `Sucker!`
- iOS bundle identifier: `com.ejsmith.sucker`
- iOS build number starts at `1`; EAS remote versioning auto-increments store
  builds.
- Android package: `com.ejsmith.sucker`
- Android version code starts at `1`; EAS remote versioning auto-increments
  store builds.
- Invite universal link entitlement: `applinks:sucker.games`
- Export compliance plist flag: `ios.config.usesNonExemptEncryption = false`
  for standard platform/TLS encryption only. Confirm this answer in App Store
  Connect before submitting.

## Apple And Expo Setup

1. Confirm the Apple Developer Program account is active.
2. Log in to Expo/EAS:

   ```sh
   npx eas-cli@latest login
   ```

3. Link or create the EAS project:

   ```sh
   npx eas-cli@latest init
   ```

   This should add `extra.eas.projectId` to `app.json`. Push notifications use
   that project ID at runtime.

4. Configure Apple credentials:

   ```sh
   npx eas-cli@latest credentials --platform ios
   ```

5. Create the App Store Connect app record with bundle ID
   `com.ejsmith.sucker`. If using non-interactive submit later, add the Apple
   ID from App Store Connect as `submit.production.ios.ascAppId` in `eas.json`.

## App Store Connect Metadata

- Category: Games.
- Privacy policy URL: `https://sucker.games/privacy.html`. The app uses Supabase
  auth/profile data, gameplay records, friend/profile search, invite codes, and
  Expo push tokens.
- Account deletion: the app profile screen links to `https://sucker.games/account-deletion.html`. This currently starts a manual email-confirmed deletion request; replace it with a fully automated deletion flow before App Review if Apple flags the manual process.
- Privacy labels: declare collected data based on actual behavior. At minimum,
  review email address, user ID/profile name, gameplay content/records, device
  push token/device name, diagnostics if added later, and whether each item is
  linked to the user.
- Screenshots: capture iPhone screenshots for login/lobby, active game,
  scorecard, invite/share, and game over.
- Review notes: include a test account or a reliable email-code testing path,
  plus instructions for starting a multiplayer invite game.

## Domain And Native QA Gates

- Set the GitHub repository variable `APPLE_TEAM_ID` before deploying Pages. The Pages workflow generates `https://sucker.games/.well-known/apple-app-site-association` for `applinks:sucker.games`.
- Confirm `sucker.games` invite pages either open the installed app or show a
  clear install/open fallback.
- Confirm Supabase redirect allow-list includes:
  - `https://sucker.games/auth/callback` in production
  - `sucker://auth/callback` in development builds only
  - `https://sucker.games/auth/callback`
  - `https://play.sucker.games/auth/callback`
- Run one TestFlight smoke against staging or production Supabase:
  - Sign in with an email code.
  - Create an invite and join it from a second account.
  - Play at least one turn per player.
  - Verify foreground, background, and terminated-state push delivery.
  - Verify cold-start handling for `sucker://invite/<CODE>` and
    `https://sucker.games/invite/<CODE>`.

## Build And Submit

Run local validation first:

```sh
npm run typecheck
npm run typecheck:edge
npm run test
npm run test:edge
```

Create the iOS production build:

```sh
npx eas-cli@latest build --platform ios --profile production
```

Submit the build to App Store Connect/TestFlight:

```sh
npx eas-cli@latest submit --platform ios --profile production
```

Use App Store Connect to attach the processed build to a version, complete
metadata, answer export compliance and privacy questions, submit to TestFlight
external review if needed, then submit the App Store version for review.
