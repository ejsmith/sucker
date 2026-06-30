export const phoneStageAspectRatio = 393 / 852;
export const phoneStageMinWidth = 320;
export const phoneStageMinHeight = phoneStageMinWidth / phoneStageAspectRatio;

export function getPhoneStageStyle(windowWidth: number, windowHeight: number) {
  const availableWidth = Math.max(1, windowWidth);
  const availableHeight = Math.max(1, windowHeight);
  const fittedWidth = Math.min(availableWidth, availableHeight * phoneStageAspectRatio);
  const width = Math.max(1, fittedWidth);

  return {
    aspectRatio: phoneStageAspectRatio,
    height: width / phoneStageAspectRatio,
    width,
  };
}
