/**
 * `asr-doubao` — Doubao Seed ASR 2.0 streaming provider for the host Live Talk
 * ASR seam. Credentials are resolved per operation through dsh
 * `ctx.credentials`; the binary protocol is unit-tested in
 * `doubao-asr-codec.js`.
 */

import { randomUUID } from 'node:crypto'
import {
  DOUBAO_ASR_RESOURCE_ID,
  DOUBAO_ASR_URL,
  DoubaoAsrError,
  asrAuthHeaders,
  asrResultFromFrame,
  makeAsrAudioFrame,
  makeAsrSessionStartFrame,
  parseAsrServerFrame,
} from './doubao-asr-codec.js'

function floatToPcm16(audio) {
  const values = audio instanceof Float32Array ? audio : Float32Array.from(audio)
  const pcm = new Uint8Array(values.length * 2)
  const view = new DataView(pcm.buffer)
  for (let index = 0; index < values.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, values[index] || 0))
    view.setInt16(index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
  }
  return pcm
}

function withTimeout(promise, timeoutMs, message, code) {
  let timer
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(new DoubaoAsrError(code, message)), timeoutMs)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

export function createDoubaoAsrProvider({ resolveCredential, WebSocketImpl = globalThis.WebSocket }) {
  async function credential(name) {
    const resolved = await resolveCredential(name)
    return typeof resolved === 'string' ? resolved : (resolved?.value ?? '')
  }

  async function transcribe(audio, options = {}) {
    const startedAt = Date.now()
    const apiKey = await credential('VOLC_ASR_API_KEY')
    const appKey = (await credential('VOLC_ASR_APP_ID')) || (await credential('VOLC_APP_ID'))
    const accessKey = (await credential('VOLC_ASR_ACCESS_TOKEN')) || (await credential('VOLC_ACCESS_TOKEN'))
    const resourceId = (await credential('VOLC_ASR_RESOURCE_ID')) || DOUBAO_ASR_RESOURCE_ID
    const headers = asrAuthHeaders({ apiKey, appKey, accessKey, resourceId })

    const pcm = floatToPcm16(audio)
    const sampleRate = options.sampleRate || 16_000
    const requestId = options.requestId || randomUUID()

    const socket = new WebSocketImpl(DOUBAO_ASR_URL, { headers })
    socket.binaryType = 'arraybuffer'

    await new Promise((resolveOpen, rejectOpen) => {
      socket.addEventListener('open', resolveOpen, { once: true })
      socket.addEventListener('error', (event) => {
        rejectOpen(new DoubaoAsrError('ASR_CONNECT_FAILED', '豆包 ASR 连接失败', { statusCode: String(event?.code ?? '') }))
      }, { once: true })
    })

    try {
      socket.send(makeAsrSessionStartFrame({ userId: appKey || 'live', sampleRate, requestId }))
      const chunkSize = 3200 // 100 ms at 16 kHz mono int16
      for (let offset = 0; offset <= pcm.length; offset += chunkSize) {
        const end = Math.min(offset + chunkSize, pcm.length)
        socket.send(makeAsrAudioFrame(pcm.subarray(offset, end), { final: end === pcm.length }))
        if (end === pcm.length) break
      }

      let latestText = ''
      while (true) {
        const raw = await withTimeout(
          new Promise((resolveMessage, rejectMessage) => {
            const onMessage = (message) => {
              cleanup()
              resolveMessage(message.data)
            }
            const onError = (failure) => {
              cleanup()
              rejectMessage(new DoubaoAsrError('ASR_STREAM_ERROR', '豆包 ASR 流错误', { statusCode: String(failure?.code ?? '') }))
            }
            const onClose = (closeEvent) => {
              cleanup()
              rejectMessage(new DoubaoAsrError('ASR_STREAM_CLOSED', '豆包 ASR 流提前关闭', {
                statusCode: String(closeEvent?.code ?? ''),
              }))
            }
            const cleanup = () => {
              socket.removeEventListener('message', onMessage)
              socket.removeEventListener('error', onError)
              socket.removeEventListener('close', onClose)
            }
            socket.addEventListener('message', onMessage)
            socket.addEventListener('error', onError)
            socket.addEventListener('close', onClose)
          }),
          options.timeoutMs || 30_000,
          '豆包 ASR 等待最终结果超时',
          'ASR_TIMEOUT',
        )

        const parsed = parseAsrServerFrame(raw)
        const result = asrResultFromFrame(parsed)
        if (!result) continue
        if (result.text) latestText = result.text
        if (result.final) {
          return { text: latestText, engine: 'doubao', latencyMs: Date.now() - startedAt }
        }
      }
    } finally {
      try {
        socket.close()
      } catch {
        // Socket may already be closed.
      }
    }
  }

  return {
    id: 'doubao',
    capability: 'asr',
    label: '豆包流式 ASR（Seed ASR 2.0）',
    available: () => true,
    transcribe,
  }
}
