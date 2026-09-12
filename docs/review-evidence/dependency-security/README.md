# Dependency parser regressions

The [before report](before.png) shows the same five regression tests against the original dependency tree: malformed query decoding, ICNS parsing, and JPEG XL parsing each exceeded the bounded two-second subprocess timeout; UUID v5 silently accepted an undersized output buffer. These are local library reproductions, not a claim of a demonstrated remote exploit against the deployed app.

The [after report](after.png) shows all five tests passing. Valid Unicode, plus/space decoding, PNG/ICNS dimensions, and the xcode UUID consumer are also checked. [Phone gameplay](game-after.png) was exercised at 393 × 852: roll, score, computer response, and return to the next turn.

Changes:

- Apply compatible lockfile patch updates; keep Expo SDK 57.
- Backport the upstream MIT decoder 0.5.0 into a small CommonJS compatibility package. Upstream 0.5.0 is ESM while the installed query-string consumer uses require; the adapter preserves its prior plus-to-space API.
- Override UUID to the patched CommonJS-compatible 11.1.1 release.
- Apply two idempotent bounds guards to image-size 1.2.1 during postinstall. Reject invalid ICNS entry sizes and ISO box sizes below eight bytes or beyond the buffer. The script fails if the expected upstream version/source changes, requiring a fresh review.

`npm ci`, both typechecks, 93 app tests, 11 Edge tests, lint, Expo alignment, 20/20 Expo Doctor checks, and a local web export passed. The export is 6.01 MB, JavaScript 2.03 MB, within the existing budgets. Existing authenticated browser fixtures could not run against the credential-free preview; the phone interaction above was verified directly. No native build was run.

The production dependency audit changed from 23 flagged packages (8 high, 15 moderate) to four high flags. Those remaining flags are image-size and its Metro parents: npm audit sees the unchanged upstream version and cannot account for these local guards. This PR does not claim a clean audit. Remove the temporary image parser patch once a compatible upstream release covers these paths.

Upstream references: [decoder advisory and fix](https://github.com/SamVerschueren/decode-uri-component/security/advisories/GHSA-vcc3-ghjq-m6fr), [UUID buffer bounds](https://github.com/advisories/GHSA-w5hq-g745-h8pq), [ICNS loop](https://github.com/advisories/GHSA-w3rx-r6r6-pgpr), [JPEG XL/HEIF parsing](https://github.com/advisories/GHSA-5p2g-fcmc-qvqq).
