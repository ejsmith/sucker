# Profile text hierarchy and password disclosure

The 393 × 852 Profile baseline displays the full password form on every visit. It pushes Privacy Policy, Delete Account, and Sign Out beneath the initial viewport. Labels and input values also use the same heavy display treatment as game actions. See [before](before.png).

Password editing now opens through Set or Change Password. Cancelling, leaving Profile, and successfully saving close the editor and clear drafts. The account email remains visible. Profile field labels use larger sentence-case text; input values and account explanations use lighter weights. The game UI is unchanged. See [after](after.png).

The existing end-to-end password test now verifies the collapsed state, accessible expanded state, draft cancellation, successful saving, blank fields on reopening, and sign-in with the new password. It passes against the isolated local Supabase backend. The one intentional password-form snapshot was inspected and updated. Both typechecks, 88 app tests, 11 Edge tests, and lint passed. No native build or hosted deployment was performed.
