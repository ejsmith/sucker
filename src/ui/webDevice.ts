export function isMobileWebDevice(navigator: Pick<Navigator, 'userAgent' | 'maxTouchPoints'> | undefined) {
  const userAgent = navigator?.userAgent ?? '';
  return (
    /Android|iPhone|iPad|iPod/i.test(userAgent) ||
    (/Macintosh/i.test(userAgent) && (navigator?.maxTouchPoints ?? 0) > 1)
  );
}
