// Strips personal data and credentials from text sent to error monitoring.
// Shared by the app and the Edge Functions so both redact the same way.
const sensitivePatterns: Array<[RegExp, string]> = [
  [/ExponentPushToken\[[^\]]*\]/g, 'ExponentPushToken[…]'],
  [/https:\/\/[^\s"'<>)]*(?:push|fcm|notify)[^\s"'<>)]*/gi, '<push-endpoint>'],
  [/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '<email>'],
  [/\beyJ[\w-]+\.[\w-]+\.[\w-]+/g, '<jwt>'],
  [/\b(Bearer\s+)\S+/gi, '$1<token>'],
  // PostgreSQL constraint errors echo row values.
  [/\b(Key \([^)]*\))=\([^)]*\)/g, '$1=(…)'],
  [/(Failing row contains )\(.*\)/g, '$1(…)'],
];

export function redactSensitiveText(text: string) {
  return sensitivePatterns.reduce((result, [pattern, replacement]) => result.replace(pattern, replacement), text);
}
