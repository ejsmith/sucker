# Release Quality Checklist

Use this checklist for store builds and any change to native dependencies, Expo config, authentication, notifications, or deep links.

## Monitoring

- Set `EXPO_PUBLIC_EXCEPTIONLESS_API_KEY` in the EAS `development`, `preview`, and `production` environments and in GitHub repository variables.
- Set `EXPO_PUBLIC_EXCEPTIONLESS_SERVER_URL` only when using a self-hosted collector.
- Verify one handled test exception appears with the app version, build, platform, update ID, sanitized route, and profile ID.
- Confirm Exceptionless private-information collection remains disabled and no invite codes or auth callback values are attached.
- Background and reopen the app to verify queued events are delivered.

## Native smoke test

Run the **Native Build** GitHub workflow for iOS and Android. It also creates a preview smoke build for both platforms on the first day of each month. Install preview builds through TestFlight and the Play internal testing track when validating a release candidate.

- Cold start, background for five minutes, resume, and force quit/reopen.
- Sign in through email callback and confirm SecureStore session restoration.
- Open invitation and game notification links from a terminated app.
- Register push notifications, receive a turn notification, and clear the badge.
- Play, score, respond, rematch, remove a game, and play against the computer.
- Enable airplane mode during a request, reconnect, and verify it applies at most once.
- Verify Android predictive back and iOS swipe-back return to the populated lobby.

## Accessibility

- VoiceOver and TalkBack traverse controls in visual order and announce selected dice and disabled actions.
- Opening a dialog moves focus into it; closing returns focus to the invoking control.
- Roll results, validation failures, offline state, and synchronization changes are announced once.
- Test the largest system text size without clipping critical controls or introducing game-screen scrolling.
- Test Reduce Motion, increased contrast, and both portrait phone screen-size extremes.

## Performance

Profile a release build on a lower-end Android device with React Native DevTools.

- Lobby displays cached content immediately and remains responsive during refresh.
- Game interactions and dice animations stay near 60 frames per second without long JS tasks.
- Repeated lobby/game navigation does not continuously increase memory.
- Avatar and result images do not trigger visible decoding stalls.
- `npm run check:bundle-size` passes after the production web export.

Record device, OS, app version, cold-start time, lobby time-to-content, slowest interaction, and peak memory in the release notes so regressions are comparable.

## Updates

- Publish to the `preview` channel first and test on preview binaries with the same app version/runtime.
- Publish to `production` only after native smoke, accessibility, and offline/reconnect checks pass.
- Increment the app version whenever native dependencies or native configuration change.
- Monitor Exceptionless after release and stop or replace a rollout if errors increase.
