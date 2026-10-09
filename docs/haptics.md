# Game haptics

Haptics Lab is hidden in every build: development, internal preview, TestFlight,
App Store, and web. The app no longer imports or renders its screen or menu item.
Gameplay haptics and saved device choices remain active. Web produces no haptics.
The lab component remains in source for future tuning work, but has no entry point.

The native game uses authored patterns instead of closely related system taps:

| Effect      | Starting duration | Shape                                                         |
| ----------- | ----------------- | ------------------------------------------------------------- |
| Crack       | 800 ms            | Sharp strike with a long fading continuous burst              |
| Body blow   | 300 ms            | Low strike with a sustained, fading tail                      |
| Rumble      | 450 ms            | Three continuous waves without discrete strikes               |
| Double hit  | 300 ms            | Sharp strike, silence, then a heavier hit                     |
| Build & pop | 450 ms            | Accelerating strikes over a rising vibration, ending in a pop |
| Victory     | 600 ms            | Three separated bursts increasing in strength and sharpness   |
| Double rev  | 900 ms            | Short rising rev, quiet pause, then a longer, stronger rev    |

Both landing a punch and getting punched default to **Crack** at **800 ms**,
**100% strength**, **50% sharpness**, and **0 ms start delay**, with one pass and
100% hit/rumble levels. This matches the chosen phone tuning. **Double rev** stays
the Sucker default. Code and browser checks cannot establish which feels satisfying.

Existing saved choices stay active and are not reset when the lab is hidden.

Double rev aims for “vvvvvrroo… vvvvvrooom”: a 330 ms swell, 80 ms of silence,
then a stronger 490 ms swell with a sustained peak and a smooth release. Both
strength and sharpness rise through each rev; there are no impact taps. Duration
scales the whole pair, and repeats repeat the pair.

## Retained lab controls (currently unavailable)

These notes describe the retained component for future tuning work. The current
app does not expose these controls in any build.

1. **Choose effect** selects a shape; **Tune effect** opens its controls. The lab
   opens on tuning so your saved effect is ready to adjust. **Try choice**, **Try
   saved**, and **Try original** compare
   it with your saved choice and the vibration from before the first lab.
2. Turn off **Replay game moment** to compare by feel alone. Previews never roll
   dice, spend tokens, submit turns, or send multiplayer actions.
3. Adjust strength (5–100%) and sharpness (0–100%) in 5% steps, or duration
   (50–900 ms) and start delay (0–250 ms after the result appears) in 10 ms steps.
   Sharpness at 50% preserves the pattern's authored texture; 0% softens it and
   100% sharpens it. Duration scales one pass, preserving its rhythm.
4. Expand **Hits, rumble & repeats** to mix discrete strikes and continuous
   vibration independently (0–100%, in 5% steps). Zero removes that layer. Rumble
   and Double rev have no discrete strikes, so they only show rumble strength.
   Repeat a pattern one to three times with 25–400 ms of silence between passes,
   in 25 ms steps.
   Strength scales both layers together. The longest pattern is 3.5 seconds.
5. **Preview changes** plays each edit immediately while keeping the controls
   open. Turn it off to edit silently and use **Try choice** when ready.
   **Reset this effect** restores the shape's starting values; **Restore saved**
   returns to the saved settings for that event. Neither button saves by itself.
6. **Use this in games** saves that event's choice on this device. The three
   events are independent. Closing without saving discards the draft.
7. **Off** disables an event; **Original** restores its old system vibration.

The waveform shows strength over time; vertical lines mark discrete strikes.
Graphs span the complete timeline, including repeats and their quiet gaps.
The preview/save buttons stay visible while the tuning controls scroll.

## Native implementation

`react-native-pulsar` 1.7.0 supplies the native engine: Core Haptics on iOS and
Pulsar's Android implementation. Patterns combine discrete strikes and continuous
amplitude/sharpness curves. The whole pattern is submitted to native at once;
including repeats; only the optional initial delay uses a JavaScript timer. No
sound is added.

`driver.native.ts` accesses Pulsar's pinned `RNPulsar` bridge. The public 1.7.0
composer hook's imperative `parse()` allocates a new native handle without
releasing its previous handle. `nativePatternPlayer.ts` instead explicitly stops
and releases the previous handle before creating the next, retaining at most one.
Check this bridge contract when upgrading Pulsar. Web resolves `driver.ts`, which
never imports the native library. Missing/unsupported engines are reported in
the lab; custom patterns do not silently fall back to identical system taps.

Starting a preview, switching choices/tabs, closing the lab, backgrounding, or
unmounting cancels delayed starts and stops/releases the active native pattern.
Normal game feedback is suppressed while the lab is open. An already delivered
strike cannot be recalled. Android hardware may approximate curves and sharpness;
test its feel separately from iPhone.

Preferences use AsyncStorage `sucker.haptics.v2`. When absent, the provider reads v1:
Off and Original survive, retired presets use the new default for their event,
and the old tap spacing is discarded. The v1 record remains available to an older
app version; the first explicit save writes the complete v2 preferences. Older
v2 choices gain neutral defaults (100% hit and rumble levels, one pass), preserving
their feel until edited. Mix and repeat settings are saved separately per event.

## Build and validation

The native engine needs a compatible app binary. App version/runtime **1.4.2** includes
Pulsar and the current Expo native dependencies. Build and submit from the MacBook
using the existing production EAS profile. After this engine is installed, these
pattern data and lab controls can be adjusted in JavaScript.

Required automated checks are the app/Edge typechecks and test suites.
`tests/haptics.test.cjs` covers migration, layer mixing, tuning bounds, silent
repeat gaps, complete native timelines,
replacement/background cancellation, and native resource cleanup.
`e2e/haptics.spec.ts` checks that the game menu hides the lab in development and
preserves saved choices through reload and gameplay. The production export smoke
test checks the same visibility and persistence behavior. Native prebuild/codegen
checks do not replace compiling and testing an iOS binary.

On a physical phone, test actual landed punches, received punches, and Suckers
(a missed punch must not play a landed hit). Confirm previously saved choices
still apply after relaunch. Background during an effect: it must stop and must
not resume later. Confirm the game menu has no Haptics Lab entry.

References: [Pulsar React Native SDK](https://docs.swmansion.com/pulsar/sdk/react-native/)
and [Pulsar preset playground](https://docs.swmansion.com/pulsar/presets-playground/).
