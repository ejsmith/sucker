# Reach older completed games

The local baseline had 51 completed fixture games, but the API and screen stopped at 25 with no way to open older results ([before](before.png)).

The screen now offers [Load older games](load-more.png), fetching bounded pages of 25. The cursor uses completion time, update time, and ID, preserving PostgreSQL microseconds and handling legacy null completion dates. The [after screen](after.png) shows all 51 results available. Older scorecards and rematches use the same existing components.

The local browser regression checks every fixture ID exactly once across three pages, including tied timestamps, microsecond differences, and null dates. A simulated 503 lasting through automatic retries preserves the first 25 results, displays a recoverable error, and succeeds when retried. The oldest scorecard opens successfully. Both typechecks, 88 app tests, 11 Edge tests, lint, and whitespace checks pass.

Loaded history is scoped to the signed-in profile and reset by manual refresh. Background refresh merges the newest page without discarding the pages the player has opened. This change does not claim to establish native performance or real-user active-list scale.
