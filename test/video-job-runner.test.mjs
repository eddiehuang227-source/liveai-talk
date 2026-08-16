import test from 'node:test'
import assert from 'node:assert/strict'
import { createVideoJobHooks } from '../lib/core/video-job-runner.js'

test('video job polls the provider and settles completed with the video output', async () => {
  const provider = {
    async submitVideo(input) {
      return { taskId: '12345678901234', reqKey: 'req', dialogue: input.dialogue }
    },
    async queryVideo(task) {
      assert.equal(task.taskId, '12345678901234')
      provider.queries += 1
      if (provider.queries === 1) return { status: 'in_queue' }
      return { status: 'done', videoUrl: 'https://example.com/video.mp4', requestId: 'req-1' }
    },
  }
  provider.queries = 0
  const hooks = createVideoJobHooks({ provider, input: { dialogue: '你好' }, pollMs: 1 })
  const outcome = await hooks.done
  assert.equal(outcome.status, 'completed')
  assert.match(hooks.readOutput(), /video\.mp4/)
})

test('cancel settles the job as killed before the next poll', async () => {
  const provider = {
    async submitVideo() {
      return { taskId: '12345678901234' }
    },
    async queryVideo() {
      return { status: 'in_queue' }
    },
  }
  const hooks = createVideoJobHooks({ provider, input: {}, pollMs: 1 })
  hooks.cancel('user said stop')
  const outcome = await hooks.done
  assert.equal(outcome.status, 'killed')
  assert.equal(outcome.detail, 'user said stop')
})
