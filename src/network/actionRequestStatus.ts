// Only explicit player requests belong here. Background refresh/recovery stays quiet.
export function createActionRequestStatus(delayMs = 3000) {
  const slowRequests = new Set<symbol>();
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());

  return {
    getSnapshot: () => slowRequests.size > 0,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async run<T>(request: () => Promise<T>): Promise<T> {
      const id = Symbol();
      const timer = setTimeout(() => {
        slowRequests.add(id);
        notify();
      }, delayMs);
      try {
        return await request();
      } finally {
        clearTimeout(timer);
        if (slowRequests.delete(id)) notify();
      }
    },
  };
}

export const actionRequestStatus = createActionRequestStatus();
