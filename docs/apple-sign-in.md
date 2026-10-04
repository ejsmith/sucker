# Sign in with Apple

In the native iOS app, players can choose **Continue with Apple** without creating
an email/password account first. Authentication uses Apple's native sign-in sheet
and a nonce-verified ID token. Apple sign-in and account linking are not offered
on web or Android, including an iPhone browser or installed PWA. There is no
Apple browser OAuth fallback, and the auth service rejects non-iOS calls.

Email codes and passwords remain available on every platform. New Apple players
choose their public player name before entering the lobby; a username is optional.
Both fields start blank, and the app does not request their full legal name from
Apple or suggest a name from their private relay address. They can edit these
fields later in Profile.

The profile stores `needs_profile_setup` so an interrupted signup resumes setup
after reopening the app. Saving the name and completing setup happen in one
profile update. Existing players and accounts that link Apple keep their profiles
and skip setup. Unfinished Apple-created accounts can also complete this step
after signing in by email on another platform.

Existing players should sign in to the iOS app using their current method, open **Profile →
Account**, and connect Apple there. This links Apple to their existing player ID,
including when Apple supplies a different private relay email. Supabase can
automatically link matching verified email addresses, but Hide My Email can
otherwise create a separate account. The app does not merge separate accounts or
their games. An Apple identity already connected elsewhere produces an error
without switching accounts.

To access the same account on web or Android, use the email shown in Profile and
an email code or a password set through **Profile → Account → Set or Change
Password**. For an account created with Hide
My Email, this can be Apple's private relay address. Linking Apple to an existing
email account preserves that account and its original email sign-in method.

## Provider setup

1. Enable **Sign in with Apple** for the Apple Developer App ID
   `com.ejsmith.sucker`.
2. Enable Apple under Supabase **Authentication → Sign In / Providers**. Include
   `com.ejsmith.sucker` in Client IDs so Supabase accepts the native token audience.
   Native ID-token sign-in does not need a browser Services ID or an OAuth client
   secret. Do not disable nonce verification.
3. Enable **Allow manual linking** in Supabase authentication settings. The local
   equivalent is `auth.enable_manual_linking = true` in `supabase/config.toml`.
4. Register the app's email sending domain/address with Apple's private email
   relay so players using Hide My Email can also receive email sign-in codes.

Keep the existing email-auth redirect URLs configured. Native Apple sign-in does
not use them and does not need an Apple browser callback URL.

Apply `20261004220000_apple_profile_setup.sql` before releasing the updated app.
The migration marks only new Apple-created profiles for setup and uses `Player`
as their temporary name. Existing profiles retain their names and are not marked
for setup.

The Supabase provider and Apple Developer setup are external to this repository.
Changing local `config.toml` does not configure the hosted project. No Edge
Function changes are needed. The migration and provider setup must be applied to
the hosted project separately; this implementation does not deploy them.

## Native release and verification

`app.json` enables `ios.usesAppleSignIn` and the `expo-apple-authentication`
plugin. An iOS binary containing this module and capability is required; an OTA
JavaScript update alone cannot add it. Follow the normal native release process
when a build is requested. Expo Go has a different Apple token audience and is
not proof that the production bundle identifier is configured correctly.

Before enabling a release, verify on a signed iPhone build:

- First sign-in with both Share My Email and Hide My Email, sign-out, repeat
  sign-in, and session restoration after reopening the app.
- New Apple players must choose a name, with username optional. Restart before
  saving to verify setup resumes; restart after saving to verify it does not.
- Saving a taken username keeps the entered name and allows retrying or clearing
  the optional username. Existing and linked accounts must skip setup.
- Cancellation and provider errors leave the email sign-in controls usable.
- Connect Apple from an existing player's profile, then sign out and use Apple;
  the player ID and games must be unchanged.
- Trying to connect an Apple identity already attached to another account shows
  the provider error and retains the current account.
- Web and Android show email sign-in only, including the profile/account screen.
- An iOS-created account can sign in on web with its account email and an email
  code, including delivery through Apple's private relay when applicable.

Automated coverage in `tests/appleAuth.test.cjs` checks native nonce handling,
linking, cancellation, provider errors, rejection on web/Android, and the shared
email-auth callback exchange. Browser coverage in `e2e/apple-auth.spec.ts` checks
that Apple controls are absent and email sign-in still works using mocked auth
responses. It does not replace real Apple/device validation.

References: [Supabase Apple setup](https://supabase.com/docs/guides/auth/social-login/auth-apple),
[Supabase identity linking](https://supabase.com/docs/guides/auth/auth-identity-linking),
[Expo SDK 57 AppleAuthentication](https://docs.expo.dev/versions/v57.0.0/sdk/apple-authentication/).
