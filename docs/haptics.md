# Trying custom game haptics

Open a game → three-dot menu → **Haptics Lab** in the iPhone or Android app.
Web previews the layout and game artwork, but produces no haptics.

The second lab replaces the closely related system taps with six authored
patterns. Each event can use any pattern:

| Effect      | Starting duration | Shape                                                         |
| ----------- | ----------------- | ------------------------------------------------------------- |
| Crack       | 100 ms            | Sharp strike with a short continuous burst                    |
| Body blow   | 300 ms            | Low strike with a sustained, fading tail                      |
| Rumble      | 450 ms            | Three continuous waves without discrete strikes               |
| Double hit  | 300 ms            | Sharp strike, silence, then a heavier hit                     |
| Build & pop | 450 ms            | Accelerating strikes over a rising vibration, ending in a pop |
| Victory     | 600 ms            | Three separated bursts increasing in strength and sharpness   |

The defaults are **Crack** for landing a punch, **Body blow** for getting punched,
and **Build & pop** for a Sucker. These are candidates for physical device testing;
code and browser checks cannot establish which feels satisfying.

1. Select a shape, then **Try choice**. **Try saved** and **Try original** compare
   it with your saved choice and the vibration from before the first lab.
2. Turn off **Replay game moment** to compare by feel alone. Previews never roll
   dice, spend tokens, submit turns, or send multiplayer actions.
3. Expand **Tune effect** to adjust strength (25–100%), sharpness (0–100%),
   duration (50–900 ms), and start delay (0–250 ms after the result appears).
   Sharpness at 50% preserves the pattern's authored texture; 0% softens it and
   100% sharpens it. Duration scales the entire timeline, preserving its rhythm.
4. **Reset this effect** restores the selected shape's starting values.
5. **Use this in games** saves that event's choice on this device. The three
   events are independent. Closing without saving discards the draft.
6. **Off** disables an event; **Original** restores its old system vibration.

The waveform shows strength over time; vertical lines mark discrete strikes.
All graphs span their selected duration, so compare the displayed duration too.
The preview/save buttons stay visible while the tuning controls scroll.

## Native implementation

`react-native-pulsar` 1.7.0 supplies the native engine: Core Haptics on iOS and
Pulsar's Android implementation. Patterns combine discrete strikes and continuous
amplitude/sharpness curves. The whole pattern is submitted to native at once;
only the optional initial delay uses a JavaScript timer. No sound is added.

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

Preferences use AsyncStorage `sucker.haptics.v2`. When absent, the lab reads v1:
Off and Original survive, retired presets use the new default for their event,
and the old tap spacing is discarded. The v1 record remains available to an older
app version; the first explicit save writes the complete v2 preferences.

## Build and validation

The new native engine needs a new app binary. App version/runtime **1.3.1** keeps
it separate from 1.3.0 binaries without Pulsar. Build and submit from the MacBook
using the existing production EAS profile. After this engine is installed, these
pattern data and lab controls can be adjusted in JavaScript.

Required automated checks are the app/Edge typechecks and test suites.
`tests/haptics.test.cjs` covers migration, tuning bounds, complete native timelines,
replacement/background cancellation, and native resource cleanup.
`e2e/haptics.spec.ts` covers phone layout, independent persistence, failed saves,
discarded drafts, and preview isolation from gameplay. Native prebuild/codegen
checks do not replace compiling and testing an iOS binary.

On a physical phone, compare each shape both with and without artwork; save a
different choice for each event and confirm it after relaunch. Test actual landed
punches, received punches, and Suckers (a missed punch must not play a landed hit).
Start a long rumble and immediately stop, close, or background: it must stop and
must not resume later. Test Off, repeated auditions, and the tuning extremes.

References: [Pulsar React Native SDK](https://docs.swmansion.com/pulsar/sdk/react-native/)
and [Pulsar preset playground](https://docs.swmansion.com/pulsar/presets-playground/).
