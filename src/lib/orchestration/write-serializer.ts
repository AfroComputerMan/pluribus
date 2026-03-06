/**
 * WriteSerializer - Promise-chain write queue for SQLite.
 *
 * Ensures async write operations execute sequentially with no interleaving.
 * A failed write does not block subsequent writes.
 */
export class WriteSerializer {
  private chain: Promise<unknown> = Promise.resolve();

  /**
   * Queue an async function to run after all previously queued functions complete.
   * Returns the result of the function. Errors propagate to the caller but do not
   * block subsequent queued operations.
   */
  serialize<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.chain.then(fn, () => fn());
    // Keep the chain alive even if fn rejects -- swallow errors in the chain
    this.chain = result.catch(() => {});
    return result;
  }
}
