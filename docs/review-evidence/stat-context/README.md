# Statistics scope and metric explanations

A fresh signed-in test account was seeded with one completed 180–160 computer result. Its new 0–0 match appeared directly above that saved record without a saved-history heading, and specialized metrics had no definitions ([before](before.png)).

The screen now labels Saved computer games separately from Current Game. Multiplayer views state whether they include all completed multiplayer games or only games between the selected players. Player identity and the Overall / Vs You switch are preserved. An expandable explanation covers blowouts, comebacks, buzzer beaters, Sucker hunts/misses, punch rates, category rates, and token averages, using the existing calculation definitions and shared margin constants. [After](after.png), [definitions](definitions.png).

The seeded statistics regression and existing player-avatar/context flow pass. All three phone stats/menu/layout cases pass, with only their intentional stats-overlay snapshots retained. Both typechecks and 11 Edge tests passed. All 88 app cases passed across the initial suite and the targeted text-policy rerun after adding the required scaling props; lint passed. No statistics calculations, database records outside test fixtures, native builds, or hosted deployments changed.
