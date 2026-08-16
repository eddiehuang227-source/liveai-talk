import test from 'node:test'
import assert from 'node:assert/strict'
import {
  EV_FINISH_SESSION,
  EV_START_CONNECTION,
  EV_START_SESSION,
  EV_TASK_REQUEST,
  EV_TTS_RESPONSE,
  buildPcmRequestFrames,
  extractPcmChunk,
  makeTtsFrame,
  parseTtsFrame,
} from '../lib/providers/doubao-tts-codec.js'

test('makeTtsFrame/parseTtsFrame round-trips JSON frames with and without session ids', () => {
  const frame = makeTtsFrame(EV_START_SESSION, { event: EV_START_SESSION, req_params: { speaker: 'x' } }, 'sid-1')
  const parsed = parseTtsFrame(frame)
  assert.equal(parsed.event, EV_START_SESSION)
  assert.deepEqual(parsed.object, { event: EV_START_SESSION, req_params: { speaker: 'x' } })
  assert.equal(parsed.audio, null)

  const noSession = parseTtsFrame(makeTtsFrame(EV_START_CONNECTION, {}))
  assert.equal(noSession.event, EV_START_CONNECTION)
  assert.deepEqual(noSession.object, {})
})

test('buildPcmRequestFrames emits the four frame PCM-path handshake', () => {
  const { sessionId, frames } = buildPcmRequestFrames('你好，世界。', { speaker: 'test-speaker', speechRate: 15 })
  assert.equal(frames.length, 4)
  assert.deepEqual(frames.map((frame) => parseTtsFrame(frame).event), [
    EV_START_CONNECTION,
    EV_START_SESSION,
    EV_TASK_REQUEST,
    EV_FINISH_SESSION,
  ])
  const startSession = parseTtsFrame(frames[1]).object
  assert.equal(startSession.req_params.speaker, 'test-speaker')
  assert.equal(startSession.req_params.audio_params.format, 'pcm')
  assert.equal(startSession.req_params.audio_params.sample_rate, 24_000)
  assert.equal(startSession.req_params.audio_params.speech_rate, 15)
  assert.equal(parseTtsFrame(frames[2]).object.req_params.text, '你好，世界。')
  assert.ok(sessionId)
})

test('parseTtsFrame treats non-JSON bodies as binary audio', () => {
  const audio = new Uint8Array([0x00, 0x01, 0x02, 0x03])
  const frame = new Uint8Array(8 + audio.length)
  const view = new DataView(frame.buffer)
  frame[0] = 0x11
  frame[1] = 0x14
  frame[2] = 0x10
  view.setUint32(4, EV_TTS_RESPONSE)
  frame.set(audio, 8)
  const parsed = parseTtsFrame(frame)
  assert.equal(parsed.event, EV_TTS_RESPONSE)
  assert.equal(parsed.object, null)
  assert.deepEqual(parsed.audio, audio)
})

test('extractPcmChunk follows the verified 4+36+4+pcm frame shape', () => {
  const uuid = new Uint8Array(36).fill(0x61)
  const pcm = new Uint8Array([1, 2, 3, 4, 5])
  const body = new Uint8Array(44 + pcm.length)
  const view = new DataView(body.buffer)
  view.setUint32(0, 36)
  body.set(uuid, 4)
  view.setUint32(40, pcm.length)
  body.set(pcm, 44)

  assert.deepEqual(extractPcmChunk(body), pcm)
  assert.equal(extractPcmChunk(new Uint8Array(10)), null)
})
