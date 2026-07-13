export const phoneStageAspectRatio = 393 / 852;
export const phoneStageMinWidth = 320;
export const phoneStageMinHeight = phoneStageMinWidth / phoneStageAspectRatio;
export const phoneStageMaxWidth = 430;
export const phoneStageMaxHeight = 932;
export const phoneStageFillWidthBreakpoint = 500;

export function getPhoneStageStyle(
  windowWidth: number,
  windowHeight: number,
  { fillNarrowViewport = true }: { fillNarrowViewport?: boolean } = {},
) {
  const availableWidth = Math.max(1, windowWidth);
  const availableHeight = Math.max(1, windowHeight);

  if (fillNarrowViewport && availableWidth < phoneStageFillWidthBreakpoint) {
    return {
      height: availableHeight,
      width: availableWidth,
    };
  }

  const fittedWidth = Math.min(
    availableWidth,
    availableHeight * phoneStageAspectRatio,
    phoneStageMaxWidth,
    phoneStageMaxHeight * phoneStageAspectRatio,
  );
  const width = Math.max(1, fittedWidth);

  return {
    aspectRatio: phoneStageAspectRatio,
    height: width / phoneStageAspectRatio,
    width,
  };
}
