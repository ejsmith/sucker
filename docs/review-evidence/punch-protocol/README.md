# Integrated Punch review follow-ups

The dependency PR received the invitation and Punch PRs from an external merge, then current main. Review of that integrated content found two additional protocol/recovery defects.

- [Legacy before](legacy-before.png): an old client sent a displayed one (10%), the server resolved six (75%) and charged three tokens. [After](legacy-after.png): direct throws without a saved preparation return an update/prepare error and leave tokens and the response window unchanged. A provided display die must also match the saved server die. New-client preparation, retry, concurrent preparation, throwing, and replay remain covered.
- [Recovery before](recovery-before.png): delayed preparation recovery selected an obsolete response-window snapshot over a newer active game. [After](recovery-after.png): the recovery selector excludes non-mutating preparation snapshots, and the app clears the pending error without replacing game state.

The original recovery selector was extracted unchanged to reproduce its behavior, then fixed and used by the app. The protocol reproduction used the isolated local Edge runtime and database. All 24 integration cases, 11 recovery tests, both typechecks, lint, and 11 Edge tests pass. These screenshots show actual test output, not app screens. No hosted deployment or database reset was performed for these checks.
# Rejected preparation follow-up

A controlled HTTP 400 on prepare_sucker_punch left the dialog open after its roll animation, with no dismissal path. The null-result path now closes the dialog and leaves the server error visible. The local browser regression verifies the board accepts the next roll and retains all 10 tokens. Screenshots are `preparation-before.png` and `preparation-after.png`; the regression was exercised on the resume branch containing this integrated protocol. The successful authoritative-chance browser case also passes.
