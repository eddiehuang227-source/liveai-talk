import test from 'node:test'
import assert from 'node:assert/strict'
import { createJimengProvider } from '../lib/providers/video-jimeng.js'

function response(body, ok = true, status = 200) {
  return {
    ok,
    status,
    text: async () => JSON.stringify(body),
  }
}

function credentials(values) {
  return async (name) => values[name]
}

test('submitVideo signs the CVSync2AsyncSubmitTask call and returns a provider task', async () => {
  const calls = []
  const signedPost = async (action, body, options) => {
    calls.push({ action, body, options })
    return response({
      code: 10000,
      message: 'Success',
      request_id: 'req-1',
      data: { task_id: '12345678901234' },
    })
  }
  const provider = createJimengProvider({
    resolveCredential: credentials({ VOLCENGINE_ACCESS_KEY_ID: 'ak', VOLCENGINE_SECRET_ACCESS_KEY: 'sk' }),
    signedPost,
  })

  const task = await provider.submitVideo({
    dialogue: '今天也要一起加油。',
    emotion: 'happy',
    frames: 241,
    imageUrl: 'https://example.com/avatar.jpg',
    characterId: 'chie',
    ability: 'v30_pro_1080',
  })

  assert.equal(calls.length, 1)
  assert.equal(calls[0].action, 'CVSync2AsyncSubmitTask')
  assert.equal(calls[0].options.accessKeyId, 'ak')
  assert.equal(calls[0].options.secretAccessKey, 'sk')
  assert.equal(calls[0].body.req_key, 'jimeng_ti2v_v30_pro')
  assert.deepEqual(calls[0].body.image_urls, ['https://example.com/avatar.jpg'])
  assert.match(calls[0].body.prompt, /今天也要一起加油/)
  assert.equal(task.provider, 'jimeng')
  assert.equal(task.taskId, '12345678901234')
  assert.equal(task.status, 'in_queue')
})

test('queryVideo reuses the submit reqKey and returns the done video URL', async () => {
  const calls = []
  const signedPost = async (action, body) => {
    calls.push({ action, body })
    if (action === 'CVSync2AsyncSubmitTask') {
      return response({ code: 10000, request_id: 'req-1', data: { task_id: '12345678901234' } })
    }
    return response({
      code: 10000,
      request_id: 'req-2',
      data: { status: 'done', video_url: 'https://example.com/video.mp4', aigc_meta_tagged: true },
    })
  }
  const provider = createJimengProvider({
    resolveCredential: credentials({ VOLCENGINE_ACCESS_KEY_ID: 'ak', VOLCENGINE_SECRET_ACCESS_KEY: 'sk' }),
    signedPost,
  })
  await provider.submitVideo({ dialogue: '你好', ability: 'v30_720' })

  const result = await provider.queryVideo({ taskId: '12345678901234' })
  assert.equal(calls[1].action, 'CVSync2AsyncGetResult')
  assert.equal(calls[1].body.req_key, 'jimeng_i2v_first_tail_v30')
  assert.equal(result.status, 'done')
  assert.equal(result.videoUrl, 'https://example.com/video.mp4')
  assert.equal(result.aigcMetaTagged, true)
})

test('provider maps upstream rate-limit codes to a 429-class error', async () => {
  const signedPost = async () => response({ code: 50429, message: 'quota exceeded', request_id: 'req-rate' })
  const provider = createJimengProvider({
    resolveCredential: credentials({ VOLCENGINE_ACCESS_KEY_ID: 'ak', VOLCENGINE_SECRET_ACCESS_KEY: 'sk' }),
    signedPost,
  })
  await assert.rejects(
    () => provider.submitVideo({ dialogue: '你好' }),
    (error) => {
      assert.equal(error.code, 'JIMENG_RATE_LIMITED')
      assert.equal(error.status, 429)
      assert.equal(error.requestId, 'req-rate')
      return true
    },
  )
})

test('submitVideo rejects localhost and private-network image URLs', async () => {
  const provider = createJimengProvider({
    resolveCredential: credentials({}),
    signedPost: async () => { throw new Error('should not be called') },
  })
  await assert.rejects(
    () => provider.submitVideo({ dialogue: '你好', imageUrl: 'http://127.0.0.1/x.jpg' }),
    (error) => error.code === 'INVALID_IMAGE_URL' && error.status === 400,
  )
})
