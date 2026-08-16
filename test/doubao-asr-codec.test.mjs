import test from 'node:test'
import assert from 'node:assert/strict'
import { gzipSync } from 'node:zlib'
import {
  DOUBAO_ASR_RESOURCE_ID,
  DoubaoAsrError,
  asrAuthHeaders,
  asrResultFromFrame,
  makeAsrAudioFrame,
  makeAsrServerFrame,
  makeAsrSessionStartFrame,
  parseAsrClientFrame,
  parseAsrServerFrame,
} from '../lib/providers/doubao-asr-codec.js'

test('auth headers select app-key or direct api-key auth', () => {
  const headers = asrAuthHeaders({ appKey: 'app', accessKey: 'token' })
  assert.equal(headers['X-Api-Resource-Id'], DOUBAO_ASR_RESOURCE_ID)
  assert.match(headers['X-Api-Connect-Id'], /^[0-9a-f-]{36}$/)
  assert.equal(headers['X-Api-App-Key'], 'app')
  assert.equal(headers['X-Api-Access-Key'], 'token')
  const direct = asrAuthHeaders({ apiKey: 'key' })
  assert.equal(direct['x-api-key'], 'key')
  assert.throws(() => asrAuthHeaders({}), (error) => error.code === 'ASR_MISSING_CREDENTIAL')
})

test('client JSON and audio frames round-trip through the client parser', () => {
  const session = parseAsrClientFrame(makeAsrSessionStartFrame({ sampleRate: 16_000 }))
  assert.equal(session.messageType, 0x1)
  assert.deepEqual(JSON.parse(new TextDecoder().decode(session.payload)).audio, {
    format: 'pcm', sample_rate: 16_000, channel: 1, bits: 16,
  })

  const audio = parseAsrClientFrame(makeAsrAudioFrame(new Uint8Array([1, 2]), { final: true }))
  assert.equal(audio.messageType, 0x2)
  assert.equal(audio.flags, 0x2)
  assert.deepEqual(audio.payload, new Uint8Array([1, 2]))
})

test('result frames decode text and finality, and reject provider error codes', () => {
  const resultFrame = parseAsrServerFrame(makeAsrServerFrame(0x9, 0x2, 0x0, {
    code: 0,
    result: { text: '你好，世界' },
  }))
  assert.deepEqual(asrResultFromFrame(resultFrame), { text: '你好，世界', final: true })

  const failure = parseAsrServerFrame(makeAsrServerFrame(0x9, 0x2, 0x0, {
    code: 5000,
    message: '没有权限',
  }))
  assert.throws(() => asrResultFromFrame(failure), (error) => {
    assert.ok(error instanceof DoubaoAsrError)
    assert.equal(error.code, 'ASR_RESULT_FAILED')
    assert.equal(error.statusCode, '5000')
    return true
  })
})

test('gzip-compressed server frames are decompressed transparently', () => {
  const payload = gzipSync(Buffer.from(JSON.stringify({ code: 0, result: { text: '压缩帧' } })))
  const parsed = parseAsrServerFrame(makeAsrServerFrame(0x9, 0x2, 0x1, payload))
  assert.equal(parsed.body.result.text, '压缩帧')
  assert.equal(asrResultFromFrame(parsed).text, '压缩帧')
})
