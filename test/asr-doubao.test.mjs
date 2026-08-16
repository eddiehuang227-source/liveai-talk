import test from 'node:test'
import assert from 'node:assert/strict'
import { createDoubaoAsrProvider } from '../lib/providers/asr-doubao.js'
import { makeAsrServerFrame, parseAsrClientFrame } from '../lib/providers/doubao-asr-codec.js'

class FakeAsrSocket {
  static instances = []

  constructor(url, options) {
    this.url = url
    this.headers = options?.headers ?? {}
    this.sent = []
    this.listeners = new Map()
    this.binaryType = 'blob'
    FakeAsrSocket.instances.push(this)
    queueMicrotask(() => this.dispatch('open', {}))
  }

  addEventListener(name, handler, options = {}) {
    if (!this.listeners.has(name)) this.listeners.set(name, [])
    this.listeners.get(name).push({ handler, once: Boolean(options?.once) })
  }

  removeEventListener(name, handler) {
    const list = this.listeners.get(name)
    if (list) this.listeners.set(name, list.filter((entry) => entry.handler !== handler))
  }

  dispatch(name, event) {
    for (const entry of [...(this.listeners.get(name) ?? [])]) {
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

function credentials(values) {
  return async (name) => values[name]
}

test('provider refuses transcription without credentials before opening a socket', async () => {
  FakeAsrSocket.instances.length = 0
  const provider = createDoubaoAsrProvider({
    resolveCredential: credentials({}),
    WebSocketImpl: FakeAsrSocket,
  })
  await assert.rejects(
    () => provider.transcribe(new Float32Array([0.1])),
    (error) => error.code === 'ASR_MISSING_CREDENTIAL',
  )
  assert.equal(FakeAsrSocket.instances.length, 0)
})

test('provider streams PCM frames and returns the final transcript', async () => {
  FakeAsrSocket.instances.length = 0
  const provider = createDoubaoAsrProvider({
    resolveCredential: credentials({
      VOLC_APP_ID: 'app',
      VOLC_ACCESS_TOKEN: 'token',
      VOLC_ASR_RESOURCE_ID: 'volc.seedasr.sauc.duration',
    }),
    WebSocketImpl: FakeAsrSocket,
  })

  const pending = provider.transcribe(new Float32Array([0, 0.25, -0.5]), { sampleRate: 16_000 })
  await new Promise((resolveWait) => setTimeout(resolveWait, 0))
  const socket = FakeAsrSocket.instances[0]
  assert.ok(socket)
  assert.equal(socket.headers['X-Api-App-Key'], 'app')
  assert.equal(socket.headers['X-Api-Access-Key'], 'token')

  const sent = socket.sent.map((frame) => parseAsrClientFrame(frame))
  assert.equal(sent[0].messageType, 0x1)
  assert.equal(JSON.parse(new TextDecoder().decode(sent[0].payload)).audio.sample_rate, 16_000)
  const audioFrame = sent.at(-1)
  assert.equal(audioFrame.messageType, 0x2)
  assert.equal(audioFrame.flags, 0x2) // final audio frame

  socket.dispatch('message', {
    data: makeAsrServerFrame(0x9, 0x2, 0x0, { code: 0, result: { text: '你好，世界' } }),
  })
  const result = await pending
  assert.deepEqual(result, { text: '你好，世界', engine: 'doubao', latencyMs: result.latencyMs })
  assert.equal(typeof result.latencyMs, 'number')
  assert.equal(socket.closed, true)
})
