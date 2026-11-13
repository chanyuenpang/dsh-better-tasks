/** One detached editor owns a real Session reference until all admitted work settles. */
export interface SurfaceLifetime {
  readonly closing: boolean
  readonly flights: number
  readonly closed: Promise<void>
  isAvailable(): boolean
  withOperation<T>(operation: () => T | Promise<T>): Promise<T>
  whenSettled(): Promise<void>
  dispose(): void
}

export function createSurfaceLifetime(callbacks: {
  close(): void
  release(): void
  changed?(closing: boolean, flights: number): void
}): SurfaceLifetime {
  let closing = false
  let released = false
  let flights = 0
  const waiters = new Set<() => void>()
  let finishClosed!: () => void
  const closed = new Promise<void>(resolve => { finishClosed = resolve })
  const changed = () => callbacks.changed?.(closing, flights)
  const settle = () => {
    if (flights !== 0) return
    for (const resolve of waiters) resolve()
    waiters.clear()
    if (!closing || released) return
    released = true
    try { callbacks.release() } finally { finishClosed() }
  }
  return {
    get closing() { return closing },
    get flights() { return flights },
    closed,
    isAvailable: () => !closing && flights === 0,
    async withOperation<T>(operation: () => T | Promise<T>): Promise<T> {
      if (closing) throw new Error('Input surface is closing')
      flights += 1
      changed()
      try { return await operation() } finally {
        flights -= 1
        changed()
        settle()
      }
    },
    whenSettled(): Promise<void> {
      return flights === 0 ? Promise.resolve() : new Promise(resolve => { waiters.add(resolve) })
    },
    dispose(): void {
      if (closing) return
      closing = true
      changed()
      try { callbacks.close() } finally { settle() }
    },
  }
}
