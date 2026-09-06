# CommonJS compatibility backport

This is the MIT-licensed decoder from upstream decode-uri-component 0.5.0, which fixes CVE-2026-45822 with a bounded UTF-8 scanner. The only API adaptations are a CommonJS export and the 0.2.x plus-to-space behavior expected by existing query-string consumers. The upstream license is preserved alongside the source.

Source: https://github.com/SamVerschueren/decode-uri-component/tree/v0.5.0

Remove this compatibility package when the Expo/React Navigation dependency chain can consume the patched upstream ESM package directly. Do not replace it with the vulnerable 0.2.x package to satisfy an audit resolver suggestion.
