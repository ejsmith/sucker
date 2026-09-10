# Make inviting a friend the primary path

The previous screen presented search first, joining second, and creating an invite last with similar emphasis ([before](before.png)).

The first card now offers Create Invite Link and explains that the game starts when the friend joins. Joining with an existing code follows, then player search. All three paths remain directly available, and the separately verified accessible field labels are preserved. No challenge policy or game-creation behavior changed. See [after](after.png), inspected at 393 × 852.

The new browser regression verifies card order, named fields, invite generation, and profile search. The existing complete two-player invite/redemption/gameplay flow also passes against isolated local Supabase. Both typechecks, 88 app tests, 11 Edge tests, and lint passed. This PR is based on the field-label fix (#70); no hosted deployment or native build was performed.
# Rebase accessibility verification

The separated friend-entry branch lost the player-search field's explicit accessible name. Both CI and a local browser regression failed to find the textbox named `Find a player by username or name`. Restoring that label makes the same role-based assertion pass in Chromium and WebKit. The existing end-to-end invitation and search test remains unchanged.

`label-before.png` and `label-after.png` are actual local 393 x 852 app captures. The visible layout is unchanged; the correction is the name exposed to assistive technology. Local verification used mocked account responses and did not create accounts or reset a database.
