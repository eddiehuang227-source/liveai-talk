import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

function loadClient(options = {}) {
  let handoff
  const spoken = []
  const sandbox = {
    SpeechSynthesisUtterance: class {
      constructor(text) {
        this.text = text
        this.voice = null
        this.rate = 1
      }
    },
    window: {
      __ModuleLoader__: {
        load(value) {
          handoff = value
        },
      },
      speechSynthesis: options.speechSynthesis ?? null,
      SpeechRecognition: options.SpeechRecognition ?? null,
      webkitSpeechRecognition: options.webkitSpeechRecognition ?? null,
    },
  }
  vm.runInNewContext(source, sandbox, { filename: 'lib/client.js' })
  assert.ok(handoff, 'client bundle must register a module factory')
  const react = {
    createElement: () => ({}),
    useEffect: () => undefined,
    useState: (initial) => [initial, () => undefined],
  }
  const exports = handoff.factory((specifier) => {
    if (specifier === 'react') return react
    throw new Error(`unexpected external require: ${specifier}`)
  })
  return { handoff, exports, sandbox, spoken }
}

function fakeCtx() {
  const services = new Map()
  const registrations = []
  const disposers = []
  return {
    services,
    registrations,
    disposers,
    ctx: {
      provide(key, value) {
        services.set(key, value)
        return () => services.delete(key)
      },
      slots: {
        inject(_name, callback) {
          const dispose = callback()
          disposers.push(dispose)
          return dispose
        },
        register(options, component) {
          registrations.push({ options, component })
          return () => {
            registrations.pop()
          }
        },
      },
    },
  }
}

test('client bundle registers under the package id', () => {
  const { handoff } = loadClient()
  assert.equal(handoff.id, 'dsh-live-talk')
  assert.equal(typeof handoff.factory, 'function')
})

test('client half declares slots as its only dsh service dependency', () => {
  const { exports } = loadClient()
  assert.equal(exports.inject.length, 1)
  assert.equal(exports.inject[0], 'slots')
  assert.equal(typeof exports.apply, 'function')
})

test('apply registers a reversible conversation view through the slot seam', () => {
  const { exports } = loadClient()
  const { ctx, registrations, disposers } = fakeCtx()
  exports.apply(ctx)
  assert.equal(registrations.length, 1)
  assert.equal(registrations[0].options.name, 'conversation.view')
  assert.equal(registrations[0].options.id, 'live-talk')
  assert.equal(registrations[0].options.label, 'Live Talk')
  assert.equal(typeof registrations[0].options.inject, 'function')
  assert.equal(typeof registrations[0].component, 'function')
  for (const dispose of disposers) dispose()
  assert.equal(registrations.length, 0)
})

test('client TTS seam registers the zero-key browser provider and speaks through it', () => {
  const speechSynthesis = {
    getVoices: () => [{ name: 'Tingting', lang: 'zh-CN' }],
    speak: (utterance) => {
      assert.equal(utterance.text, '你好，我是星之宫知惠。')
      assert.equal(utterance.voice.name, 'Tingting')
    },
    cancel: () => undefined,
  }
  const { exports } = loadClient({ speechSynthesis })
  const { ctx, services } = fakeCtx()
  exports.apply(ctx)

  const tts = services.get('liveTts')
  assert.ok(tts, 'client half must provide liveTts')
  assert.deepEqual(JSON.parse(JSON.stringify(tts.list())), [{ id: 'browser-tts', label: '浏览器语音合成（零 Key）', available: true }])
  const handle = tts.speak('你好，我是星之宫知惠。')
  assert.equal(typeof handle.cancel, 'function')
})


test('client ASR seam registers the zero-key browser speech provider', () => {
  class FakeRecognition {
    constructor() {
      FakeRecognition.last = this
      this.lang = ''
      this.interimResults = true
    }

    start() {
      this.started = true
    }

    stop() {
      this.stopped = true
    }
  }

  const { exports } = loadClient({ SpeechRecognition: FakeRecognition })
  const { ctx, services } = fakeCtx()
  exports.apply(ctx)

  const asr = services.get('liveAsr')
  assert.ok(asr, 'client half must provide liveAsr')
  assert.deepEqual(JSON.parse(JSON.stringify(asr.list())), [{ id: 'browser-speech', label: '浏览器语音识别（零 Key）', available: true }])

  let transcript = ''
  const handle = asr.start({
    onResult: (text) => { transcript = text },
  })
  const recognition = FakeRecognition.last
  assert.equal(recognition.lang, 'zh-CN')
  assert.equal(recognition.started, true)
  recognition.onresult({ resultIndex: 0, results: [[{ transcript: '你好' }]] })
  assert.equal(transcript, '你好')
  handle.stop()
  assert.equal(recognition.stopped, true)
})
