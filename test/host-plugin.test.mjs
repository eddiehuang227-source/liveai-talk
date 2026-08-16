import test from 'node:test'
import assert from 'node:assert/strict'
import { apply, Config, inject, name } from '../lib/index.js'

class FakeResponse {
  constructor() {
    this.statusCode = 0
    this.headers = {}
    this.body = ''
  }

  writeHead(status, headers = {}) {
    this.statusCode = status
    Object.assign(this.headers, headers)
    return this
  }

  end(body) {
    this.body = String(body)
    return this
  }
}

function fakeContext(options = {}) {
  const routes = new Map()
  const services = new Map()
  const disposers = []
  const listeners = new Map()
  const agents = new Map()
  const jobSpecs = []
  const ctx = {
    provide(key, value) {
      services.set(key, value)
      return () => services.delete(key)
    },
    effect(effectBody) {
      const dispose = effectBody()
      disposers.push(dispose)
      return dispose
    },
    on(name, handler) {
      const key = `${name}:${Math.random()}`
      listeners.set(key, handler)
      return () => listeners.delete(key)
    },
    agents: {
      get(sessionId) {
        return options.agent || agents.get(sessionId) || null
      },
    },
    credentials: {
      resolve: async (reference) => {
        const value = options.credentials?.[reference]
        return value === undefined ? undefined : { value }
      },
    },
    jobs: {
      attachController: () => () => {},
      start(spec) {
        jobSpecs.push(spec)
        return `flowact-video-${jobSpecs.length}`
      },
    },
    webServer: {
      register(route) {
        const key = `${route.kind}:${route.path}`
        routes.set(key, route)
        return () => routes.delete(key)
      },
    },
  }
  return { ctx, routes, services, disposers, listeners, jobSpecs }
}

async function invoke(route, path = route.path, request = { url: path }) {
  const response = new FakeResponse()
  await route.handler(request, response)
  return response
}

test('host half declares the dsh entry contract', () => {
  assert.equal(name, 'flowact-avatar')
  assert.deepEqual(inject, ['webServer', 'agents', 'credentials', 'jobs'])
})

test('Config implements the Standard Schema v1 contract with defaults', () => {
  const result = Config['~standard'].validate({})
  assert.equal(result.value.title, 'FlowAct 数字人')
  assert.equal(result.value.defaultCharacter, 'chie')
  assert.equal(result.value.providerPolicy.tts, 'auto')
  assert.deepEqual(
    Config['~standard'].validate({ title: '覆盖标题', providerPolicy: { tts: 'doubao' } }).value,
    {
      title: '覆盖标题',
      defaultCharacter: 'chie',
      providerPolicy: { tts: 'doubao', asr: 'auto', avatarMedia: 'jimeng' },
    },
  )
})

test('apply provides the character, seam, pipeline, and config services', () => {
  const { ctx, services } = fakeContext()
  apply(ctx, {})
  assert.ok(services.has('flowactCharacters'))
  assert.ok(services.has('flowactSeams'))
  assert.ok(services.has('flowactPipeline'))
  assert.ok(services.has('flowactConversation'))
  assert.ok(services.has('flowactConfig'))
  assert.equal(services.get('flowactCharacters').list().length, 2)
  assert.equal(typeof services.get('flowactPipeline').analyze, 'function')
  assert.equal(typeof services.get('flowactConversation').handleSessionEvent, 'function')
})

test('http surface exposes characters and seam metadata', async () => {
  const { ctx, routes } = fakeContext()
  apply(ctx, { title: '自定义标题', defaultCharacter: 'rin' })

  const health = JSON.parse((await invoke(routes.get('exact:/flowact/health'))).body)
  assert.equal(health.ok, true)
  assert.equal(health.characters, 2)
  assert.equal(health.seams.asr.capability, 'asr')

  const characters = JSON.parse((await invoke(routes.get('exact:/flowact/characters'))).body)
  assert.equal(characters.title, '自定义标题')
  assert.equal(characters.defaultCharacter, 'rin')
  assert.equal(characters.characters[0].id, 'chie')

  const seams = JSON.parse((await invoke(routes.get('exact:/flowact/seams'))).body)
  assert.deepEqual(Object.keys(seams.seams), ['asr', 'tts', 'avatarMedia'])
  assert.deepEqual(seams.seams.asr.providers, [{ id: 'doubao' }])
  assert.deepEqual(seams.seams.tts.providers, [{ id: 'doubao' }])
  assert.deepEqual(seams.seams.avatarMedia.providers, [{ id: 'jimeng' }, { id: 'realtime-volc' }, { id: 'realtime-vidu' }])

  const asset = await invoke(routes.get('prefix:/flowact/assets'), '/flowact/assets/chie.svg')
  assert.equal(asset.statusCode, 200)
  assert.match(asset.headers['Content-Type'], /image\/svg\+xml/)
  assert.match(asset.body, /<svg/)
})

test('dialogue pipeline route analyzes emotion, action, and TTS text', async () => {
  const { ctx, routes } = fakeContext()
  apply(ctx, {})

  const request = {
    url: '/flowact/analyze',
    [Symbol.asyncIterator]() {
      const chunks = [Buffer.from(JSON.stringify({
        text: '[emotion: happy][action: wave] 太好了，我们出发吧。',
      }))]
      let index = 0
      return {
        next: async () => (index < chunks.length
          ? { value: chunks[index++], done: false }
          : { done: true }),
      }
    },
  }
  const response = await invoke(routes.get('exact:/flowact/analyze'), '/flowact/analyze', request)
  assert.equal(response.statusCode, 200)
  const result = JSON.parse(response.body)
  assert.equal(result.summary.emotion[0], 'happy')
  assert.deepEqual(result.summary.actions, ['wave'])
  assert.equal(result.summary.sentences[0].text, '太好了，我们出发吧。')
  assert.ok(result.events.some((event) => event.type === 'emotion'))
})

test('realtime volc-token route signs a short-lived websocket token', async () => {
  const { ctx, routes } = fakeContext({
    credentials: {
      VOLCENGINE_ACCESS_KEY_ID: 'ak',
      VOLCENGINE_SECRET_ACCESS_KEY: 'sk',
    },
  })
  apply(ctx, {})
  const response = await invoke(
    routes.get('exact:/flowact/realtime/volc-token'),
    '/flowact/realtime/volc-token?characterId=chie',
    { url: '/flowact/realtime/volc-token?characterId=chie' },
  )
  assert.equal(response.statusCode, 200)
  const body = JSON.parse(response.body)
  const payload = JSON.parse(Buffer.from(body.wssToken, 'base64').toString('utf8'))
  assert.match(payload.url, /^https:\/\/visual\.volcengineapi\.com\?Action=ConnectWebsocket/)
  assert.match(payload.header.Authorization, /^HMAC-SHA256 Credential=ak\//)
  assert.equal(payload.header.Host, 'visual.volcengineapi.com')
  assert.equal(typeof body.expiresAt, 'number')
})

test('realtime volc-token route reports missing credentials as 503', async () => {
  const { ctx, routes } = fakeContext()
  apply(ctx, {})
  const response = await invoke(
    routes.get('exact:/flowact/realtime/volc-token'),
    '/flowact/realtime/volc-token',
    { url: '/flowact/realtime/volc-token' },
  )
  assert.equal(response.statusCode, 503)
  assert.match(JSON.parse(response.body).error, /火山引擎访问密钥/)
})

test('video submit runs through ctx.jobs and settles failed on missing credentials', async () => {
  const { ctx, routes, jobSpecs } = fakeContext()
  apply(ctx, {})
  const request = {
    url: '/flowact/video/submit',
    [Symbol.asyncIterator]() {
      const chunks = [Buffer.from(JSON.stringify({ dialogue: '你好' }))]
      let index = 0
      return {
        next: async () => (index < chunks.length ? { value: chunks[index++], done: false } : { done: true }),
      }
    },
  }
  const response = await invoke(routes.get('exact:/flowact/video/submit'), '/flowact/video/submit', request)
  assert.equal(response.statusCode, 202)
  const body = JSON.parse(response.body)
  assert.equal(body.accepted, true)
  assert.match(body.jobId, /^flowact-video-\d+$/)

  assert.equal(jobSpecs.length, 1)
  assert.equal(jobSpecs[0].kind, 'flowact-video')
  const hooks = jobSpecs[0].run()
  assert.equal(typeof hooks.cancel, 'function')
  assert.equal(typeof hooks.readOutput, 'function')
  const outcome = await hooks.done
  assert.equal(outcome.status, 'failed')
  assert.match(outcome.detail, /火山引擎访问密钥/)
})

test('talk route forwards text into the live dsh agent', async () => {
  const followed = []
  const { ctx, routes } = fakeContext({
    agent: { followup(message) { followed.push(message) } },
  })
  apply(ctx, {})

  const request = {
    url: '/flowact/talk',
    [Symbol.asyncIterator]() {
      const chunks = [Buffer.from(JSON.stringify({ sessionId: 'session-1', text: '你好' }))]
      let index = 0
      return {
        next: async () => (index < chunks.length ? { value: chunks[index++], done: false } : { done: true }),
      }
    },
  }
  const response = await invoke(routes.get('exact:/flowact/talk'), '/flowact/talk', request)
  assert.equal(response.statusCode, 202)
  assert.equal(followed.length, 1)
  assert.equal(followed[0].content[0].text, '你好')
  assert.equal(followed[0].source.kind, 'plugin')
  assert.equal(followed[0].source.plugin, 'dsh-flowact-avatar')
})

test('session event listener feeds assistant chunks into the pipeline', async () => {
  const { ctx, listeners, routes } = fakeContext()
  apply(ctx, {})
  const handler = [...listeners.values()].find((_listener, index) => [...listeners.keys()][index].startsWith('session/event'))
  assert.equal(typeof handler, 'function')

  const subject = { id: 'session-1' }
  handler(subject, { type: 'assistant/chunk', chunk: { type: 'text-delta', text: '[emotion: happy] 今天真开心。' } })
  handler(subject, { type: 'assistant/message' })

  const response = await invoke(routes.get('prefix:/flowact/turn'), '/flowact/turn/session-1')
  assert.equal(response.statusCode, 200)
  const result = JSON.parse(response.body)
  assert.equal(result.sessionId, 'session-1')
  assert.equal(result.emotion[0], 'happy')
})

test('unloading the host half disposes every registered route', () => {
  const { ctx, routes, disposers } = fakeContext()
  apply(ctx, {})
  assert.equal(routes.size, 12)
  for (const dispose of disposers) dispose()
  assert.equal(routes.size, 0)
})
