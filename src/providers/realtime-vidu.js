/**
 * `realtime-vidu` — Vidu S1 realtime live-session provider, ported from AItalk
 * `app/api/vidu-live/route.ts`. The provider talks to the user's local Vidu
 * proxy (`VIDU_S1_PROXY_BASE`), which holds the API key; this plugin never
 * touches the key.
 */

const DEFAULT_PROXY_BASE = 'http://127.0.0.1:18088/proxy/cn'
const DEFAULT_PERSONA = '你是一位温柔、自然、回答简洁的中文陪伴助手。'

const AVATAR_IMAGES = Object.freeze({
  chie: 'https://s41.ax1x.com/2026/08/02/pm5PQyV.jpg',
  wanqing: 'https://s41.ax1x.com/2026/08/02/pm5PVoQ.jpg',
  qingxian: 'https://s41.ax1x.com/2026/08/02/pm5PnWn.jpg',
  weixi: 'https://s41.ax1x.com/2026/08/02/pm5PmJs.jpg',
})

const AVATAR_NAMES = Object.freeze({
  chie: '星之宫知惠',
  wanqing: '林晚晴',
  qingxian: '顾清弦',
  weixi: '秦未晞',
})

export class ViduRealtimeError extends Error {
  constructor(code, message, status = 502) {
    super(message)
    this.name = 'ViduRealtimeError'
    this.code = code
    this.status = status
  }
}

async function proxyJson(fetchImpl, base, path, init = {}) {
  let response
  try {
    response = await fetchImpl(`${base}${path}`, {
      ...init,
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...init?.headers,
      },
    })
  } catch (error) {
    throw new ViduRealtimeError('VIDU_PROXY_UNREACHABLE', `Vidu 本机代理不可用：${error instanceof Error ? error.message : String(error)}`)
  }
  const text = await response.text()
  let body = {}
  try {
    body = text ? JSON.parse(text) : {}
  } catch {
    body = { message: text.slice(0, 500) }
  }
  return { response, body }
}

export function createViduRealtimeProvider({
  proxyBase = process.env.VIDU_S1_PROXY_BASE || DEFAULT_PROXY_BASE,
  fetchImpl = fetch,
} = {}) {
  function isCharacterId(value) {
    return typeof value === 'string' && value in AVATAR_IMAGES
  }

  async function getCredits() {
    const { response, body } = await proxyJson(fetchImpl, proxyBase, '/ent/v2/credits?show_detail=false')
    if (!response.ok) {
      throw new ViduRealtimeError('VIDU_CREDITS_FAILED', body.message || `Vidu credits HTTP ${response.status}`, response.status)
    }
    return body
  }

  async function createSession(input = {}) {
    if (!isCharacterId(input.characterId)) {
      throw new ViduRealtimeError('VIDU_UNSUPPORTED_CHARACTER', '不支持的 Vidu S1 角色', 400)
    }
    const persona = typeof input.persona === 'string' && input.persona.trim()
      ? input.persona.trim().slice(0, 500)
      : DEFAULT_PERSONA
    const { response, body } = await proxyJson(fetchImpl, proxyBase, '/live/v1/lives', {
      method: 'POST',
      body: JSON.stringify({
        call_mode: 'audio',
        character_id: '1',
        avatar: {
          persona,
          image_uri: AVATAR_IMAGES[input.characterId],
          name: AVATAR_NAMES[input.characterId],
          voice: 'Tina',
        },
      }),
    })
    if (!response.ok) {
      throw new ViduRealtimeError('VIDU_SESSION_FAILED', body.message || body.reason || body.error || `Vidu live HTTP ${response.status}`, response.status)
    }
    return body
  }

  return {
    id: 'realtime-vidu',
    capability: 'avatar-media',
    label: 'Vidu S1 实时会话（本机代理）',
    available: () => true,
    capabilities: () => ({ modes: ['realtime-live'] }),
    getCredits,
    createSession,
  }
}
