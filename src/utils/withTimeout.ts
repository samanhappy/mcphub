/**
 * Resolve a promise if it settles within the timeout, otherwise reject with a
 * timeout error. The underlying promise is never cancelled; its eventual
 * settlement is observed but ignored once the timeout has fired, so no
 * unhandled rejection is produced.
 */
export const withTimeout = <T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> => {
  if (timeoutMs <= 0) {
    return promise;
  }

  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(message));
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
};

export default withTimeout;
