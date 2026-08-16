/**
 * Doubao bidirectional-streaming TTS wire codec, ported 1:1 from the AItalk
 * Python service (`services/doubao-tts/doubao_bidi_client.py` and the PCM
 * streaming path in `services/voice-chat/coordinator.py`).
 *
 * This module is pure bytes-in/bytes-out and has no network, crypto, or
 * vendor SDK dependency — it is unit-testable without keys or a socket.
 */

import { randomUUID } from 'node:crypto'

export const DOUBAO_TTS_URL = 'wss://openspeech.bytedance.com/api/v3/tts/bidirection'

export const EV_START_CONNECTION = 1
export const EV_FINISH_CONNECTION = 2
export const EV_CONNECTION_STARTED = 50
export const EV_CONNECTION_FAILED = 51
export const EV_CONNECTION_FINISHED = 52
export const EV_START_SESSION = 100
export const EV_FINISH_SESSION = 102
export const EV_SESSION_STARTED = 150
export const EV_SESSION_FINISHED = 152
export const EV_SESSION_FAILED = 153
export const EV_TASK_REQUEST = 200
export const EV_TTS_RESPONSE = 352

const encoder = new TextEncoder()

/** Build one binary client frame: [header 4B][event 4B][sid?][payload]. */
export function makeTtsFrame(event, payload, sessionId = undefined) {
  const data = encoder.encode(JSON.stringify(payload))
  const frame = new Uint8Array(8 + (sessionId ? 4 + encoder.encode(sessionId).length : 0) + 4 + data.length)
  const view = new DataView(frame.buffer)
  frame[0] = 0b0001_0001 // v1, 4-byte header
  frame[1] = 0b0001_0100 // full-client-request with event number
  frame[2] = 0b0001_0000 // JSON serialization
  frame[3] = 0b0000_0000 // reserved
  view.setUint32(4, event)
  let offset = 8
  if (sessionId) {
    const sid = encoder.encode(sessionId)
    view.setUint32(offset, sid.length)
    offset += 4
    frame.set(sid, offset)
    offset += sid.length
  }
  view.setUint32(offset, data.length)
  offset += 4
  frame.set(data, offset)
  return frame
}

/**
 * Parse one received server frame.
 * @returns {{ event: number, object: Record<string, unknown> | null, audio: Uint8Array | null }}
 */
export function parseTtsFrame(raw) {
  const bytes = toUint8Array(raw)
  if (bytes.length < 8) throw new Error('DOUBAO_TTS_FRAME_TOO_SHORT')
  const event = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4)
  const body = bytes.subarray(8)

  // JSON payload starts at the first '{'; everything else in a non-JSON
  // frame is binary audio (the provider sends PCM frames without JSON).
  const jsonStart = body.indexOf(0x7b)
  if (jsonStart >= 0) {
    try {
      const text = new TextDecoder().decode(body.subarray(jsonStart))
      return { event, object: JSON.parse(text), audio: null }
    } catch {
      // Fall through: the frame is treated as audio below.
    }
  }
  return { event, object: null, audio: body }
}

/**
 * Extract one PCM chunk from a `TTSResponse` audio body.
 *
 * Verified frame shape (AItalk, 2026-08-01):
 * [4B uuid_len=36][36B uuid][4B pcm_len][pcm bytes]. The header must be
 * skipped exactly once — folding it into audio creates a periodic click.
 */
export function extractPcmChunk(audio) {
  const bytes = toUint8Array(audio)
  if (bytes.length < 44) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const uuidLength = view.getUint32(0)
  if (uuidLength !== 36) throw new Error(`DOUBAO_TTS_BAD_UUID_LENGTH:${uuidLength}`)
  const pcmLength = view.getUint32(40)
  if (pcmLength < 0 || 44 + pcmLength > bytes.length) throw new Error('DOUBAO_TTS_BAD_PCM_LENGTH')
  return bytes.subarray(44, 44 + pcmLength)
}

/** Assemble the four PCM-path request frames for one synthesis. */
export function buildPcmRequestFrames(text, options = {}) {
  const sessionId = options.sessionId || randomUUID()
  const requestId = options.requestId || randomUUID()
  const connectId = options.connectId || randomUUID()
  const speaker = options.speaker || 'zh_female_jiaochuannv_uranus_bigtts'
  const speechRate = options.speechRate ?? 0
  const sampleRate = options.sampleRate || 24_000

  return {
    sessionId,
    requestId,
    connectId,
    frames: [
      makeTtsFrame(EV_START_CONNECTION, {}),
      makeTtsFrame(EV_START_SESSION, {
        event: EV_START_SESSION,
        req_params: {
          speaker,
          audio_params: { format: 'pcm', sample_rate: sampleRate, speech_rate: speechRate },
        },
      }, sessionId),
      makeTtsFrame(EV_TASK_REQUEST, {
        event: EV_TASK_REQUEST,
        req_params: { text: String(text) },
      }, sessionId),
      makeTtsFrame(EV_FINISH_SESSION, { event: EV_FINISH_SESSION }, sessionId),
    ],
  }
}

export function toUint8Array(value) {
  if (value instanceof Uint8Array) return value
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  }
  throw new Error('EXPECTED_BINARY_TTS_FRAME')
}
