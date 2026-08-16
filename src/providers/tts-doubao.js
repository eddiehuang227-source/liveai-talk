/**
 * `tts-doubao` — Doubao bidirectional streaming TTS provider for the host
 * Live Talk TTS seam.
 *
 * Credentials are resolved per operation through dsh's `ctx.credentials`
 * (`VOLC_APP_ID` / `VOLC_ACCESS_TOKEN` / optional `VOLC_RESOURCE_ID`), so a
 * rotated key reaches the next synthesis without a restart. The binary wire
 * codec lives in `doubao-tts-codec.js` and is tested independently.
 */

import { randomUUID } from 'node:crypto'
import {
  buildPcmRequestFrames,
  DOUBAO_TTS_URL,
  EV_CONNECTION_FAILED,
  EV_CONNECTION_FINISHED,
  EV_CONNECTION_STARTED,
  EV_FINISH_CONNECTION,
  EV_SESSION_FAILED,
  EV_SESSION_FINISHED,
  EV_TTS_RESPONSE,
  extractPcmChunk,
  makeTtsFrame,
  parseTtsFrame,
} from './doubao-tts-codec.js'

export const DOUBAO_VOICES = [
  ['zh_female_jiaochuannv_uranus_bigtts', '娇川女（默认）'],
  ['zh_female_xiaohe_uranus_bigtts', '小何'],
  ['zh_female_jitangmei_uranus_bigtts', '鸡汤妹'],
  ['zh_female_gujie_uranus_bigtts', '古姐'],
  ['zh_female_sajiaoxuemei_uranus_bigtts', '撒娇学妹'],
  ['zh_female_zhixingnv_uranus_bigtts', '知性女'],
  ['zh_female_tianmeitaozi_uranus_bigtts', '甜美桃子'],
  ['ICL_uranus_zh_female_tianmeihuopo_tob', '甜美活泼'],
  ['ICL_uranus_zh_female_chengshuwenrou_tob', '成熟温柔'],
  ['ICL_uranus_zh_female_xiemeiyujie_tob', '邪魅御姐'],
  ['ICL_uranus_zh_female_xingganmeihuo_tob', '性感魅惑'],
  ['ICL_uranus_zh_female_jiaohannvwang_tob', '娇憨女王'],
  ['ICL_uranus_zh_female_bingjiaomengmei_tob', '冰娇萌妹'],
  ['ICL_uranus_zh_female_bingjiaojiejie_tob', '冰娇姐姐'],
].map(([id, label]) => ({ id, label }))

export class DoubaoTtsError extends Error {
  constructor(code, message, details = {}) {
    super(message)
    this.name = 'DoubaoTtsError'
    this.code = code
    this.details = details
  }
}

function speedLevelToRate(level) {
  const value = Number.isFinite(level) ? Math.round(level) : 5
  return Math.max(-50, Math.min(100, (value - 5) * 15))
}

/**
 * @param resolveCredential dsh credential resolver: async (name) => string|undefined
 * @param WebSocketImpl injectable WebSocket constructor (tests use a fake)
 */
export function createDoubaoTtsProvider({ resolveCredential, WebSocketImpl = globalThis.WebSocket }) {
  async function credential(name) {
    const resolved = await resolveCredential(name)
    return typeof resolved === 'string' ? resolved : (resolved?.value ?? '')
  }

  async function* synthesize(text, options = {}) {
    const appId = await credential('VOLC_APP_ID')
    const accessToken = await credential('VOLC_ACCESS_TOKEN')
    if (!appId || !accessToken) {
      throw new DoubaoTtsError('TTS_MISSING_CREDENTIAL', '豆包 TTS 需要 VOLC_APP_ID 与 VOLC_ACCESS_TOKEN')
    }
    const resourceId = (await credential('VOLC_RESOURCE_ID')) || 'seed-tts-2.0'
    const request = buildPcmRequestFrames(text, {
      speaker: options.voice || (await credential('VOLC_SPEAKER')) || DOUBAO_VOICES[0].id,
      speechRate: speedLevelToRate(options.speedLevel ?? 5),
      sampleRate: 24_000,
    })
    const headers = {
      'X-Api-App-Key': appId,
      'X-Api-Access-Key': accessToken,
      'X-Api-Resource-Id': resourceId,
      'X-Api-Request-Id': request.requestId,
      'X-Api-Connect-Id': request.connectId,
    }

    const socket = new WebSocketImpl(DOUBAO_TTS_URL, { headers })
    socket.binaryType = 'arraybuffer'

    await new Promise((resolveOpen, rejectOpen) => {
      socket.addEventListener('open', resolveOpen, { once: true })
      socket.addEventListener('error', (event) => {
        rejectOpen(new DoubaoTtsError('TTS_CONNECT_FAILED', '豆包 TTS 连接失败', { event }))
      }, { once: true })
    })

    try {
      for (const frame of request.frames) socket.send(frame)

      // Persistent listeners + a small queue: frames arriving while the
      // consumer processes a yielded PCM chunk are never lost.
      const queue = []
      const waiters = []
      const settle = (data, error) => {
        const waiter = waiters.shift()
        if (waiter) {
          if (error) waiter.reject(error)
          else waiter.resolve(data)
        } else if (!error) {
          queue.push(data)
        }
      }
      socket.addEventListener('message', (message) => settle(message.data))
      socket.addEventListener('error', (failure) => settle(undefined, new DoubaoTtsError('TTS_STREAM_ERROR', '豆包 TTS 流错误', { failure })))
      socket.addEventListener('close', (closeEvent) => settle(undefined, new DoubaoTtsError('TTS_STREAM_CLOSED', '豆包 TTS 流提前关闭', {
        code: closeEvent?.code,
      })))

      const receive = () => {
        if (queue.length > 0) return Promise.resolve(queue.shift())
        return new Promise((resolveMessage, rejectMessage) => {
          waiters.push({ resolve: resolveMessage, reject: rejectMessage })
        })
      }

      while (true) {
        const event = await receive()
        const { event: eventType, object, audio } = parseTtsFrame(event)
        if (eventType === EV_TTS_RESPONSE && audio) {
          const pcm = extractPcmChunk(audio)
          if (pcm && pcm.length > 0) yield pcm
          continue
        }
        if (eventType === EV_SESSION_FINISHED || eventType === EV_CONNECTION_FINISHED) break
        if (eventType === EV_SESSION_FAILED || eventType === EV_CONNECTION_FAILED) {
          throw new DoubaoTtsError('TTS_SESSION_FAILED', '豆包 TTS 会话失败', { object })
        }
        if (eventType === EV_CONNECTION_STARTED) continue
      }
    } finally {
      try {
        socket.send(makeTtsFrame(EV_FINISH_CONNECTION, { event: EV_FINISH_CONNECTION }))
      } catch {
        // The socket may already be closed.
      }
      socket.close()
    }
  }

  return {
    id: 'doubao',
    capability: 'tts',
    label: '豆包流式 TTS（seed-tts-2.0）',
    // Registration availability is a local fact; credentials are resolved per
    // operation, matching the dsh credentials seam's hot-rotation contract.
    available: () => true,
    listVoices: () => DOUBAO_VOICES.map((voice) => ({ ...voice })),
    synthesize,
  }
}
