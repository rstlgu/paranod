/** All save paths for one editor, including page-hide saves, share this queue. */
export function createSerialSaveQueue() {
  let tail: Promise<void> = Promise.resolve();
  let pending = 0;

  return {
    get pending() {
      return pending;
    },
    enqueue<T>(task: () => Promise<T>): Promise<T> {
      pending += 1;
      const result = tail.then(task);
      // A failed write must not poison the queue or cause an unhandled rejection.
      tail = result.then(
        () => {
          pending -= 1;
        },
        () => {
          pending -= 1;
        }
      );
      return result;
    },
    async idle() {
      let observed: Promise<void>;
      do {
        observed = tail;
        await observed;
      } while (observed !== tail);
    }
  };
}
