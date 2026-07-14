export type ActionRequestFailureDisposition = 'complete' | 'release' | 'retain';

export function getActionRequestFailureDisposition({
  httpStatus,
  mutationMayHaveWritten,
  persistenceFailed,
}: {
  httpStatus: number;
  mutationMayHaveWritten: boolean;
  persistenceFailed: boolean;
}): ActionRequestFailureDisposition {
  if (persistenceFailed || (httpStatus >= 500 && mutationMayHaveWritten)) {
    return 'retain';
  }

  return httpStatus >= 500 ? 'release' : 'complete';
}
