# Expo patch alignment

`npm run check:expo` failed locally and in PR #64 CI because five locked
Expo SDK 57 packages lagged the compatibility metadata by one patch.

Updated Expo, Image Manipulator, Image Picker, Notifications, and Router using
`expo install`. The SDK remains 57.

The screenshots show the actual local command output before and after.
`npm run doctor:expo` also passed all 20 checks. No native build was run.
