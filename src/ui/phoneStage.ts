export const phoneStageAspectRatio = 393 / 852;
const phoneStageMaxWidth = 393;
const phoneStageMaxHeight = 852;

export function getPhoneStageStyle(windowWidth: number, windowHeight: number) {
  const availableWidth = Math.max(1, Math.min(windowWidth, phoneStageMaxWidth));
  const availableHeight = Math.max(1, Math.min(windowHeight, phoneStageMaxHeight));
  const windowAspectRatio = availableWidth / availableHeight;

  if (windowAspectRatio > phoneStageAspectRatio) {
    return {
      height: availableHeight,
      width: availableHeight * phoneStageAspectRatio,
    };
  }

  return {
    height: availableWidth / phoneStageAspectRatio,
    width: availableWidth,
  };
}
