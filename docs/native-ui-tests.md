# Native UI smoke tests

The Maestro suite exercises the actual React Native views on Android and iOS. It intentionally covers deterministic offline gameplay so the same flows can run without a hosted test account or Supabase environment.

## Covered journeys

- Open the local computer game, roll, hold and reroll a die, and score Chance.
- Buy an Extra Roll, use a Mulligan, take a Sucker Deal, and verify the roll and token balances after each action.

The flows open the `sucker://local` route and use React Native `testID` values rather than coordinates, so one set of files works across phone sizes and both platforms without depending on multiplayer configuration.

## Run in GitHub Actions

Open **Actions > Native UI Smoke > Run workflow**, choose `both`, `android`, or `ios`, and start the run. The jobs build unsigned local native apps on GitHub-hosted runners and do not use EAS Build or require Supabase configuration.

Android runs on Ubuntu with a hardware-accelerated emulator. iOS runs on the pinned `macos-15` image with an iOS Simulator. Failed runs upload Maestro's screenshots and diagnostics as workflow artifacts when available.

## Run locally

1. Install the [Maestro CLI](https://docs.maestro.dev/getting-started/installing-maestro/linux) and Java 17 or newer.
2. Start an Android emulator or, on macOS, an iOS Simulator.
3. Install a packaged build with the `com.ejsmith.sucker` application ID. A local release build avoids EAS usage:

   ```sh
   npx expo run:android --variant release
   ```

   Or on macOS:

   ```sh
   npx expo run:ios --configuration Release
   ```

4. Run the smoke suite:

   ```sh
   npm run test:e2e:native
   ```

To select a particular connected device:

```sh
maestro --device <device-id> test --include-tags smoke .maestro
```

Maestro clears application state before each flow. Do not point these flows at a device whose local Sucker data needs to be preserved.

## Authenticated and notification coverage

Sign-in, avatar selection, and push notification delivery depend on external accounts, OS permission prompts, and a reachable backend. Keep those as a separate release checklist or add a dedicated test environment before automating them; they should not make the offline native smoke gate flaky.
