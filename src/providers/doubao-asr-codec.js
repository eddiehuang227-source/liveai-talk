/**
 * Doubao Seed ASR 2.0 streaming WebSocket codec, ported 1:1 from the AItalk
 * Python service (`services/voice-chat/doubao_asr.py`). Pure bytes in/out —
 * no socket, no keys, no SDK.
 */

import { gunzipSync } from 'node:zlib'
import { randomUUID } from 'node:crypto'

export const DOUBAO_ASR_URL = 'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel'
export const DOUBAO_ASR_RESOURCE_ID = 'volc.seedasr.sauc.duration'
export const DOUBAO_ASR_SUCCESS_CODES = new Set([0, 1000, 3000])
const MESSAGE_RESULT = 0x9
const MESSAGE_ERROR = 0xF

const encoder = new TextEncoder()

export class DoubaoAsrError extends Error {
  constructor(code, message, details = {}) {
    super(message)
    this.name = 'DoubaoAsrError'
    this.code = code
    this.statusCode = details.statusCode ?? ''
    this.logId = details.logId ?? ''
  }
}

export function asrAuthHeaders({
  apiKey = '',
  appKey = '',
  accessKey = '',
  resourceId = DOUBAO_ASR_RESOURCE_ID,
  connectId = randomUUID(),
} = {}) {
  const headers = {
    'X-Api-Resource-Id': resourceId,
    'X-Api-Connect-Id': connectId,
  }
  if (appKey && accessKey) {
    headers['X-Api-App-Key'] = appKey
    headers['X-Api-Access-Key'] = accessKey
  } else if (apiKey) {
    headers['x-api-key'] = apiKey
  } else {
    throw new DoubaoAsrError('ASR_MISSING_CREDENTIAL', '豆包 ASR 凭证未配置')
  }
  return headers
}

export function makeAsrClientFrame(messageType, flags, serialization, payload) {
  const bytes = payload instanceof Uint8Array ? payload : encoder.encode(JSON.stringify(payload))
  const frame = new Uint8Array(8 + bytes.length)
  const view = new DataView(frame.buffer)
  frame[0] = 0x11
  frame[1] = ((messageType & 0x0F) << 4) | (flags & 0x0F)
  frame[2] = (serialization & 0x0F) << 4
  frame[3] = 0x00
  view.setUint32(4, bytes.length)
  frame.set(bytes, 8)
  return frame
}

export function makeAsrSessionStartFrame({ userId = 'flowact', sampleRate = 16_000, requestId = randomUUID() } = {}) {
  return makeAsrClientFrame(0x1, 0x0, 0x1, {
    user: { uid: userId || 'flowact' },
    audio: { format: 'pcm', sample_rate: sampleRate, channel: 1, bits: 16 },
    request: {
      reqid: requestId,
      sequence: 1,
      show_utterances: true,
      result_type: 'full',
      language: 'zh-CN',
      enable_itn: true,
      enable_punc: true,
    },
  })
}

export function makeAsrAudioFrame(pcmBytes, { final = false } = {}) {
  return makeAsrClientFrame(0x2, final ? 0x2 : 0x0, 0x0, pcmBytes)
}

/** Decode a CLIENT-shaped frame (header, size, payload — no sequence field). */
export function parseAsrClientFrame(raw) {
  const frame = raw instanceof Uint8Array ? raw : new Uint8Array(raw)
  if (frame.length < 8) throw new DoubaoAsrError('ASR_FRAME_TOO_SHORT', '豆包 ASR 客户端帧过短')
  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength)
  const headerSize = (frame[0] & 0x0F) * 4
  const messageType = (frame[1] >> 4) & 0x0F
  const flags = frame[1] & 0x0F
  const size = view.getUint32(headerSize)
  return { messageType, flags, payload: frame.subarray(headerSize + 4, headerSize + 4 + size) }
}

/**
 * Build a server-shaped frame. Final/negative flags carry a 4-byte sequence
 * field after the header, exactly as the Python `_server_payload` decoder
 * expects; `compression` uses 1 for gzip payloads.
 */
export function makeAsrServerFrame(messageType, flags, compression, payload) {
  const body = payload instanceof Uint8Array ? payload : encoder.encode(JSON.stringify(payload))
  const withSequence = flags === 0x1 || flags === 0x2 || flags === 0x3
  const frame = new Uint8Array(4 + (withSequence ? 4 : 0) + 4 + body.length)
  const view = new DataView(frame.buffer)
  frame[0] = 0x11
  frame[1] = ((messageType & 0x0F) << 4) | (flags & 0x0F)
  frame[2] = compression & 0x0F
  frame[3] = 0x00
  let offset = 4
  if (withSequence) {
    view.setUint32(offset, 1)
    offset += 4
  }
  view.setUint32(offset, body.length)
  offset += 4
  frame.set(body, offset)
  return frame
}

export function parseAsrServerFrame(raw) {
  const frame = raw instanceof Uint8Array ? raw : new Uint8Array(raw)
  if (frame.length < 8) throw new DoubaoAsrError('ASR_FRAME_TOO_SHORT', '豆包 ASR 返回帧过短')
  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength)
  const headerSize = (frame[0] & 0x0F) * 4
  const messageType = (frame[1] >> 4) & 0x0F
  const flags = frame[1] & 0x0F
  const compression = frame[2] & 0x0F
  let offset = headerSize
  if (flags === 0x1 || flags === 0x2 || flags === 0x3) offset += 4 // sequence
  let errorCode = 0
  if (messageType === MESSAGE_ERROR) {
    if (frame.length < offset + 4) throw new DoubaoAsrError('ASR_ERROR_FRAME_SHORT', '豆包 ASR 错误帧无状态码')
    errorCode = view.getUint32(offset)
    offset += 4
  }
  if (frame.length < offset + 4) throw new DoubaoAsrError('ASR_PAYLOAD_SHORT', '豆包 ASR 返回帧无负载长度')
  const size = view.getUint32(offset)
  offset += 4
  const payload = frame.subarray(offset, offset + size)
  if (payload.length !== size) throw new DoubaoAsrError('ASR_PAYLOAD_TRUNCATED', '豆包 ASR 返回帧负载不完整')
  const decompressed = compression === 0x1 ? gunzipSync(payload) : payload
  let body
  try {
    body = JSON.parse(decompressed.length ? new TextDecoder().decode(decompressed) : '{}')
  } catch {
    throw new DoubaoAsrError('ASR_INVALID_JSON', '豆包 ASR 返回了无效 JSON')
  }
  if (messageType === MESSAGE_ERROR) {
    const message = body.message || body.error || 'WebSocket 服务错误'
    throw new DoubaoAsrError('ASR_SERVER_ERROR', String(message), {
      statusCode: String(body.code ?? errorCode),
      logId: body.log_id || body.logid || '',
    })
  }
  return { messageType, flags, body }
}

/** Interpret one result frame into `{ text, final }` or throw for bad codes. */
export function asrResultFromFrame({ messageType, flags, body }) {
  if (messageType !== MESSAGE_RESULT) return null
  const code = Number(body.code || 0)
  if (!DOUBAO_ASR_SUCCESS_CODES.has(code)) {
    throw new DoubaoAsrError('ASR_RESULT_FAILED', String(body.message || '豆包 ASR 识别失败'), {
      statusCode: String(code),
      logId: body.log_id || body.logid || '',
    })
  }
  const result = body.result ?? {}
  const text = String(result.text ?? '').trim()
  const utterances = Array.isArray(result.utterances) ? result.utterances : []
  return {
    text,
    final: flags === 0x2 || flags === 0x3 || utterances.some((item) => item?.definite),
  }
}
