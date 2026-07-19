export function isLocalBackendUrl(value: string) {
  try {
    const hostname = new URL(value).hostname.toLowerCase().replace(/^\[|\]$/g, '');

    if (hostname === 'localhost' || hostname === '::1' || hostname === '0.0.0.0' || hostname.endsWith('.local')) {
      return true;
    }

    const octets = hostname.split('.').map(Number);
    if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
      return false;
    }

    const [first, second] = octets;
    return (
      first === 127 ||
      first === 10 ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168) ||
      (first === 100 && second >= 64 && second <= 127)
    );
  } catch {
    return false;
  }
}
