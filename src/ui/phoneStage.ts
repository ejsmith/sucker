export const phoneStageAspectRatio = 393 / 852;
export const phoneStageMinWidth = 320;
// Fill mode keeps narrow native and diagnostic stages at (or just above) the
// layout's 0.75 minimum content scale. Proportional web mode derives its
// roughly 694px minimum height from phoneStageMinWidth and the aspect ratio.
export const phoneStageMinHeight = 570;
export const phoneStageMaxWidth = 430;
export const phoneStageMaxHeight = 932;

export type PhoneStageOptions = {
  fillNarrowViewport?: boolean;
};

export function getPhoneStageStyle(
  windowWidth: number,
  windowHeight: number,
  { fillNarrowViewport = true }: PhoneStageOptions = {},
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
  // A web window can be too short to fit the game without making controls
  // unusably small. Preserve a proportional minimum canvas and let the host
  // scroll it instead of widening and flattening the layout.
  const width = clamp(fittedWidth, phoneStageMinWidth, phoneStageMaxWidth);

  return {
    height: width / phoneStageAspectRatio,
    width,
  };
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}
