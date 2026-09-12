# One accessible section-bonus summary

The local browser accessibility tree exposed ten copies of `+35`: the visible text plus its decorative outline layers. It also exposed two progress meters without identifying their players. [Before screenshot](before.png) and [observed accessibility excerpt](before-ax.txt).

The bonus panel now exposes one accessible image summary with the 35-point threshold, each player's name and progress, and whether the bonus is awarded. Its visual descendants are hidden from accessibility, preserving the existing artwork and board layout. [After screenshot](after.png) and [observed accessibility excerpt](after-ax.txt).

Verified visually at 393 × 852 and in the actual macOS browser accessibility tree. The browser regression checks the accessible name and absence of duplicate outline announcements. App/Edge typechecks, 88 app tests, 11 Edge tests, and lint passed. Native VoiceOver/TalkBack were not exercised.
