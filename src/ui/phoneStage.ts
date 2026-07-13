export const phoneStageAspectRatio = 393 / 852;
export const phoneStageMinWidth = 320;
// A 570px stage keeps the game at (or just above) its 0.75 minimum content
// scale. Short desktop windows intentionally receive a taller stage that the
// host can scroll rather than a canvas whose controls are clipped.
export const phoneStageMinHeight = 570;
export const phoneStageMaxWidth = 430;
export const phoneStageMaxHeight = 932;

export function getPhoneStageStyle(
  windowWidth: number,
  windowHeight: number,
  { fillNarrowViewport = true }: { fillNarrowViewport?: boolean } = {},
) {
  const availableWidth = Math.max(1, windowWidth);
  const availableHeight = Math.max(1, windowHeight);

  if (fillNarrowViewport) {
    return {
      height: clamp(availableHeight, phoneStageMinHeight, phoneStageMaxHeight),
      width: clamp(availableWidth, phoneStageMinWidth, phoneStageMaxWidth),
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
    height: width / phoneStageAspectRatio,
    width,
  };
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}
