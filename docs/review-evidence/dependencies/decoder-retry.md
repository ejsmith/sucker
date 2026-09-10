The review's distinct malformed-run input reproduced a timeout locally: 15,000 unique runs exceeded the two-second subprocess limit. The decoder now replaces each run once instead of rescanning the complete input for every distinct replacement.

The new regression preserves per-run decoding and the legacy BOM/C2 substitutions. All six dependency security tests pass; the adversarial case completed in about 134 ms locally. `decoder-before.png` and `decoder-after.png` show actual test output, not an app UI reproduction.
