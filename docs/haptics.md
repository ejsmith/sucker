# Trying game haptics

Open any game, open the three-dot menu, and choose **Haptics Lab**. The lab is
available in native builds, including TestFlight. It also opens on web for layout
and interaction checks, but web does not reproduce native haptics.

- **Punch**, **Get Hit**, and **Sucker** have independent choices.
- Select a preset, then use **Try choice**, **Try saved**, or **Try original**.
- **Replay game moment** shows the game's result artwork or Sucker banner. Turn
  it off to compare effects by feel alone. Previews never roll dice, spend tokens,
  submit a turn, or send multiplayer actions.
- Multi-tap presets allow 50–250 ms spacing. Start delay is 0–250 ms after the
  result appears. Both change in 25 ms increments.
- **Use this in games** saves that event's choice on this device. Closing the lab
  without saving leaves the previous choice active. Choose **Off** to disable
  an event, or **Original** to restore its old vibration.

Start with **Crisp** for a landed punch, **Heavy** for getting punched, and
**Success** for a Sucker. Compare **Windup**, **Aftershock**, and **Flourish** as
the multi-tap alternatives. These are starting points for device testing, not a
claim about which feels best. Test repeated use as well as the first impression.

Saved choices use AsyncStorage key `sucker.haptics.v1`. The native driver uses
Expo Haptics on iOS and Android's semantic haptic feedback on Android; the
Original preset retains React Native Vibration. iOS impact styles and Android
effects are different platform implementations and need separate device testing.
Feedback is suppressed while the lab is open and while the app is inactive.
Starting a new effect, closing the lab, or backgrounding cancels queued taps.
An impact already delivered to the hardware cannot be recalled.

## Validation

`tests/haptics.test.cjs` covers saved-choice validation, event isolation, timing,
replacement/cancellation, background suppression, and unsupported hardware.
The normal app/Edge typechecks and tests remain required.

On a physical phone:

1. Compare all three events with and without the visual preview.
2. Save different effects and timings, close/reopen the app, and confirm all three
   choices remain selected.
3. Verify landed-punch, received-punch, and Sucker feedback in a real game. A
   missed punch must not trigger the landed-punch effect.
4. Start a multi-tap preview and immediately close the lab or background the app.
   Queued taps should stop and should not replay on return.
5. Try Off for each event. Check iOS System Haptics and Low Power Mode if the
   native presets produce no feedback.

Adding Expo Haptics requires a new native build. Keep the app-version runtime
separate from previously built binaries without this native dependency. Once the
module is installed, preset/timing adjustments require only JavaScript changes.
