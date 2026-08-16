/**
 * VideoJobRunner — adapts a Live Talk avatar-media provider to the dsh
 * `ctx.jobs` contract.
 *
 * The provider owns the vendor protocol (submit/query); this module owns the
 * dsh job lifecycle: synchronous {@link run} hooks, idempotent cancellation,
 * first-wins settlement, and a consumer-readable status line.
 */

function delay(milliseconds, signal) {
  return new Promise((resolveDelay) => {
    if (signal.cancelled) {
      resolveDelay()
      return
    }
    const timer = setTimeout(resolveDelay, milliseconds)
    signal.onCancel = () => {
      clearTimeout(timer)
      resolveDelay()
    }
  })
}

export function createVideoJobHooks({ provider, input, pollMs = 10_000 }) {
  const signal = { cancelled: false, onCancel: null }
  let settled = false
  let lastOutput = 'in_queue'
  let settleResolve
  const done = new Promise((resolveDone) => {
    settleResolve = resolveDone
  })

  const settle = (status, detail = '', output = '') => {
    if (settled) return
    settled = true
    if (output) lastOutput = output
    settleResolve({ status, detail, output })
  }

  async function runWork() {
    let task
    try {
      task = await provider.submitVideo(input)
      lastOutput = JSON.stringify({ ...task, status: 'in_queue' })
    } catch (error) {
      settle('failed', error instanceof Error ? error.message : String(error))
      return
    }

    while (!signal.cancelled) {
      if (settled) return
      try {
        const result = await provider.queryVideo(task)
        if (result.status === 'done') {
          lastOutput = JSON.stringify({ ...task, ...result })
          settle('completed', `video ready · ${result.requestId || task.requestId || ''}`.trim(), lastOutput)
          return
        }
        if (result.status === 'not_found' || result.status === 'expired') {
          settle('failed', `video task ${result.status}`, JSON.stringify(result))
          return
        }
        lastOutput = JSON.stringify({ ...task, status: result.status })
        await delay(pollMs, signal)
      } catch (error) {
        settle('failed', error instanceof Error ? error.message : String(error))
        return
      }
    }
    settle('killed', 'cancelled by dsh job registry')
  }

  // `ctx.jobs.start` invokes run() synchronously; the provider work starts on
  // the next microtask, exactly like the original async submit route.
  queueMicrotask(runWork)

  return {
    cancel(reason = 'user-cancelled') {
      if (settled) return
      signal.cancelled = true
      signal.onCancel?.()
      settle('killed', reason)
    },
    done,
    readOutput: () => lastOutput,
  }
}
