export const phoneStageAspectRatio = 393 / 852;
export const phoneStageMinWidth = 320;
export const phoneStageMinHeight = phoneStageMinWidth / phoneStageAspectRatio;

export function getPhoneStageStyle(windowWidth: number, windowHeight: number) {
  const availableWidth = Math.max(1, windowWidth);
  const availableHeight = Math.max(1, windowHeight);
  const windowAspectRatio = availableWidth / availableHeight;

  if (windowAspectRatio > phoneStageAspectRatio) {
    const height = Math.max(phoneStageMinHeight, availableHeight);

    return {
      aspectRatio: phoneStageAspectRatio,
      height,
      minHeight: phoneStageMinHeight,
      minWidth: phoneStageMinWidth,
      width: height * phoneStageAspectRatio,
    };
  }

  const width = Math.max(phoneStageMinWidth, availableWidth);

  return {
    aspectRatio: phoneStageAspectRatio,
    height: width / phoneStageAspectRatio,
    minHeight: phoneStageMinHeight,
    minWidth: phoneStageMinWidth,
    width,
  };
}
