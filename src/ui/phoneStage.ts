export const phoneStageAspectRatio = 393 / 852;

export function getPhoneStageStyle(windowWidth: number, windowHeight: number) {
  const availableWidth = Math.max(1, windowWidth);
  const availableHeight = Math.max(1, windowHeight);
  const windowAspectRatio = availableWidth / availableHeight;

  if (windowAspectRatio > phoneStageAspectRatio) {
    return {
      height: '100%' as const,
      width: availableHeight * phoneStageAspectRatio,
    };
  }

  return {
    height: availableWidth / phoneStageAspectRatio,
    width: '100%' as const,
  };
}
