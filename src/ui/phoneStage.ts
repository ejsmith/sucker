export const phoneStageAspectRatio = 393 / 852;
export const phoneStageMinWidth = 320;
// Fill mode keeps narrow native and diagnostic stages at (or just above) the
// layout's 0.75 minimum content scale. Proportional web mode derives its
// roughly 694px minimum height from phoneStageMinWidth and the aspect ratio.
export const phoneStageMinHeight = 570;
export const phoneStageMaxWidth = 430;
export const phoneStageMaxHeight = 932;
const phoneViewportMaxWidth = 700;

export type PhoneStageOptions = {
  fillNarrowViewport?: boolean;
};

export function shouldFillWebViewport(
  windowWidth: number,
  navigator: Pick<Navigator, 'userAgent' | 'maxTouchPoints'> | undefined = globalThis.navigator,
) {
  // Decide from the whole window, before subtracting safe areas. A phone must
  // not acquire side gutters just because its status/home bars reduce height.
  // 430 is a desktop preview cap, not a maximum phone width (Pro Max is 440).
  // Preserve proportional layouts for short/zoomed desktop browser windows.
  const isMobile =
    /Android|iPhone|iPad|iPod/i.test(navigator?.userAgent ?? '') ||
    (/Macintosh/i.test(navigator?.userAgent ?? '') && (navigator?.maxTouchPoints ?? 0) > 1);
  return windowWidth <= phoneStageMaxWidth || (isMobile && windowWidth <= phoneViewportMaxWidth);
}

export function getPhoneStageStyle(
  windowWidth: number,
  windowHeight: number,
  { fillNarrowViewport = true }: PhoneStageOptions = {},
) {
  const availableWidth = Math.max(1, windowWidth);
  const availableHeight = Math.max(1, windowHeight);

  if (fillNarrowViewport) {
    const fillsPhone = availableWidth <= phoneViewportMaxWidth;
    return {
      height: clamp(availableHeight, phoneStageMinHeight, fillsPhone ? Infinity : phoneStageMaxHeight),
      width: clamp(availableWidth, phoneStageMinWidth, fillsPhone ? Infinity : phoneStageMaxWidth),
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
