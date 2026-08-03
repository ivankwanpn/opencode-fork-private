export type ScheduleTabPrefetch = (run: () => void) => () => void

type Task = {
  key: string
  run: () => Promise<void>
}

export function createTabPrefetchQueue(schedule: ScheduleTabPrefetch = scheduleTabPrefetch) {
  const pending: Task[] = []
  let running: string | undefined
  let cancel: (() => void) | undefined
  let disposed = false

  const arm = () => {
    if (disposed || running || cancel || pending.length === 0) return
    cancel = schedule(() => {
      cancel = undefined
      const task = pending.shift()
      if (!task) return
      running = task.key
      Promise.resolve()
        .then(task.run)
        .catch(() => undefined)
        .finally(() => {
          running = undefined
          arm()
        })
    })
  }

  return {
    add(key: string, run: () => Promise<void>) {
      if (disposed || running === key || pending.some((task) => task.key === key)) return
      pending.push({ key, run })
      arm()
    },
    promote(key: string) {
      const index = pending.findIndex((task) => task.key === key)
      if (index <= 0) return
      const task = pending.splice(index, 1)[0]
      if (!task) return
      pending.unshift(task)
    },
    remove(key: string) {
      const index = pending.findIndex((task) => task.key === key)
      if (index === -1) return
      pending.splice(index, 1)
      if (pending.length !== 0 || !cancel) return
      cancel()
      cancel = undefined
    },
    dispose() {
      disposed = true
      pending.length = 0
      cancel?.()
      cancel = undefined
    },
  }
}

export function scheduleTabPrefetch(run: () => void) {
  let idle: number | undefined
  let timer: number | undefined
  const frame = window.requestAnimationFrame(() => {
    if (window.requestIdleCallback) {
      idle = window.requestIdleCallback(run)
      return
    }
    timer = window.setTimeout(run, 0)
  })

  return () => {
    window.cancelAnimationFrame(frame)
    if (idle !== undefined) window.cancelIdleCallback(idle)
    if (timer !== undefined) window.clearTimeout(timer)
  }
}
