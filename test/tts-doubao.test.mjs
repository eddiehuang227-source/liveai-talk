import test from 'node:test'
import assert from 'node:assert/strict'
import { createDoubaoTtsProvider } from '../lib/providers/tts-doubao.js'
import {
  EV_SESSION_FINISHED,
  EV_TTS_RESPONSE,
  extractPcmChunk,
  makeTtsFrame,
  parseTtsFrame,
} from '../lib/providers/doubao-tts-codec.js'

class FakeWebSocket {
  static instances = []

  constructor(url, options) {
    this.url = url
    this.headers = options?.headers ?? {}
    this.sent = []
    this.listeners = new Map()
    this.binaryType = 'blob'
    FakeWebSocket.instances.push(this)
    queueMicrotask(() => this.dispatch('open', {}))
  }

  addEventListener(name, handler, options = {}) {
    if (!this.listeners.has(name)) this.listeners.set(name, [])
    this.listeners.get(name).push({ handler, once: Boolean(options?.once) })
  }

  removeEventListener(name, handler) {
    const list = this.listeners.get(name)
    if (!list) return
    this.listeners.set(name, list.filter((entry) => entry.handler !== handler))
  }

  dispatch(name, event) {
    const list = [...(this.listeners.get(name) ?? [])]
    for (const entry of list) {
      if (entry.once) this.removeEventListener(name, entry.handler)
      entry.handler(event)
    }
  }

  send(frame) {
    this.sent.push(frame)
  }

  close() {
    this.closed = true
  }
}

function pcmServerFrame(pcm) {
  const uuid = new Uint8Array(36).fill(0x62)
  const body = new Uint8Array(44 + pcm.length)
  const view = new DataView(body.buffer)
  view.setUint32(0, 36)
  body.set(uuid, 4)
  view.setUint32(40, pcm.length)
  body.set(pcm, 44)
  const frame = new Uint8Array(8 + body.length)
  const frameView = new DataView(frame.buffer)
  frame[0] = 0x11
  frame[1] = 0x14
  frame[2] = 0x10
  frameView.setUint32(4, EV_TTS_RESPONSE)
  frame.set(body, 8)
  return frame
}

function credentials(values) {
  return async (name) => values[name]
}

test('provider resolves credentials per operation and refuses missing keys', async () => {
  FakeWebSocket.instances.length = 0
  const provider = createDoubaoTtsProvider({
    resolveCredential: credentials({}),
    WebSocketImpl: FakeWebSocket,
  })
  await assert.rejects(async () => {
    const iterator = provider.synthesize('你好')
    await iterator.next()
  }, (error) => error.code === 'TTS_MISSING_CREDENTIAL')
  assert.equal(FakeWebSocket.instances.length, 0)
})

test('provider streams PCM chunks through the doubao bidirectional protocol', async () => {
  FakeWebSocket.instances.length = 0
  const provider = createDoubaoTtsProvider({
    resolveCredential: credentials({ VOLC_APP_ID: 'app', VOLC_ACCESS_TOKEN: 'token', VOLC_SPEAKER: 'test-speaker' }),
    WebSocketImpl: FakeWebSocket,
  })

  const iterator = provider.synthesize('你好，世界。', { voice: 'test-speaker', speedLevel: 7 })
  const pending = iterator.next()
  await new Promise((resolveWait) => setTimeout(resolveWait, 0))
  const socket = FakeWebSocket.instances[0]
  assert.ok(socket, 'provider must construct the doubao websocket')
  assert.equal(socket.binaryType, 'arraybuffer')
  assert.equal(socket.headers['X-Api-App-Key'], 'app')
  assert.equal(socket.headers['X-Api-Access-Key'], 'token')
  assert.equal(socket.headers['X-Api-Resource-Id'], 'seed-tts-2.0')
  assert.deepEqual(socket.sent.map((frame) => parseTtsFrame(frame).event).slice(0, 3), [1, 100, 200])

  const pcm = new Uint8Array([10, 20, 30])
  socket.dispatch('message', { data: pcmServerFrame(pcm) })
  socket.dispatch('message', { data: makeTtsFrame(EV_SESSION_FINISHED, { event: EV_SESSION_FINISHED }) })

  const first = await pending
  assert.equal(first.done, false)
  assert.deepEqual(first.value, pcm)
  const second = await iterator.next()
  assert.equal(second.done, true)
  assert.equal(socket.closed, true)
})
