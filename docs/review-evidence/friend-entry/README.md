# Make inviting a friend the primary path

The previous screen presented search first, joining second, and creating an invite last with similar emphasis ([before](before.png)).

The first card now offers Create Invite Link and explains that the game starts when the friend joins. Joining with an existing code follows, then player search. All three paths remain directly available, and the separately verified accessible field labels are preserved. No challenge policy or game-creation behavior changed. See [after](after.png), inspected at 393 × 852.

The new browser regression verifies card order, named fields, invite generation, and profile search. The existing complete two-player invite/redemption/gameplay flow also passes against isolated local Supabase. Both typechecks, 88 app tests, 11 Edge tests, and lint passed. This PR is based on the field-label fix (#70); no hosted deployment or native build was performed.
