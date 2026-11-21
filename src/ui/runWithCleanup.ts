// React Compiler 1.0 skips any component that contains `try … finally` or a
// `try` without `catch`, which leaves the whole screen unmemoized. Components
// call this instead, so the `finally` lives outside the compiled function.
export async function runWithCleanup<T>(work: () => Promise<T>, cleanup: () => void): Promise<T> {
  try {
    return await work();
  } finally {
    cleanup();
  }
}
