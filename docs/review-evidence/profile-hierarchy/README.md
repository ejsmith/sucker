# Profile text hierarchy and password disclosure

The 393 × 852 Profile baseline displays the full password form on every visit. It pushes Privacy Policy, Delete Account, and Sign Out beneath the initial viewport. Labels and input values also use the same heavy display treatment as game actions. See [before](before.png).

Password editing now opens through Set or Change Password. Cancelling, leaving Profile, and successfully saving close the editor and clear drafts. The account email remains visible. Profile field labels use larger sentence-case text; input values and account explanations use lighter weights. The game UI is unchanged. See [after](after.png).

The existing end-to-end password test now verifies the collapsed state, accessible expanded state, draft cancellation, successful saving, blank fields on reopening, and sign-in with the new password. It passes against the isolated local Supabase backend. The one intentional password-form snapshot was inspected and updated. Both typechecks, 88 app tests, 11 Edge tests, and lint passed. No native build or hosted deployment was performed.

CI follow-up: the only failed check compared macOS's 349 × 319 password-form capture with Linux's 349 × 316 rendering. Inspected the actual and difference images; the same controls and content are present, with platform text metrics accounting for the shift. Updated the intentional baseline from CI's canonical Linux artifact. No application behavior changed in that follow-up.
# Session reset follow-up

Signing out with an expanded editor retained both the open form and abandoned password draft after signing back in. Editor state now belongs to the authenticated session owner; changing that owner clears only the editor and draft. The browser regression signs out and back in within one page, verifies the collapsed editor, and reopens an empty password field. `session-before.png` and `session-after.png` show the difference. Typecheck and lint pass.

Review caught the first reset implementation replacing a pending invitation route. A signed-out `?invite=ABC123` opened Games after sign-in instead of the prefilled Join form. The reset now preserves navigation. Both the invitation and session-reset regressions pass; `invite-before.png` and `invite-after.png` capture the result.

## Keyboard coverage after the main rebase

Main's newer keyboard test waited for a password field while the editor was collapsed. Reproduced locally with mocked account responses: the test timed out waiting for `new-password-input`. It now opens `toggle-password-editor` before exercising both password fields, preserving all keyboard geometry and focus assertions. All six Chromium account-entry scenarios pass. `keyboard-before.png` shows the collapsed editor where the old test stopped; `keyboard-after.png` shows the form after the passing scenario. No application behavior changed.
