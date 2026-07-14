export type ActionRequestFailureDisposition = 'complete' | 'release' | 'retain';

const retryableDatabaseErrorCodes = new Set([
  '40001',
  '40P01',
  '55P03',
  '57014',
  '57P01',
  '57P02',
  '57P03',
  '58000',
  '58030',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'ECONNRESET',
  'ENETUNREACH',
  'ETIMEDOUT',
  'PGRST000',
  'PGRST001',
  'PGRST002',
  'PGRST003',
]);

export function isRetryableDatabaseError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const code = (error as { code?: unknown }).code;
  if (typeof code !== 'string') {
    return false;
  }

  return retryableDatabaseErrorCodes.has(code) || code.startsWith('08') || code.startsWith('53');
}

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
