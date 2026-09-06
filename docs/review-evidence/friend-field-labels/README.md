# Friend input accessibility labels

The integrated browser's macOS accessibility tree exposed both inputs as unnamed `text field (settable)` nodes even though the visual placeholders were present. The DOM snapshot inferred names from placeholders, so this was verified using the platform accessibility tree too. `before-ax.txt` records that baseline; `before.png` shows the screen at 393 × 852.

Explicit React Native accessibility labels give the search field its purpose and identify the invite-code field independently of placeholder/value rendering. The existing visual labels and layout are preserved. The after screenshot and accessibility-tree capture document the same fields with names. Native VoiceOver and TalkBack have not been tested.
