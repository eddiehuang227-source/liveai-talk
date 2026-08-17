/**
 * `realtime-volc` — Volcengine realtime avatar session-token provider, ported
 * from AItalk `app/api/avatar-token/route.ts`. The browser half loads the
 * vendor SDK with this short-lived WSS token; secrets never reach the client.
 */

import { createHash, createHmac } from 'node:crypto'
import { canonicalVolcQuery } from './volc-signature.js'

const DEFAULT_IMAGE = 'https://s41.ax1x.com/2026/08/02/pm5PQyV.jpg'
const AVATAR_IMAGES = Object.freeze({
  wanqing: 'https://s41.ax1x.com/2026/08/02/pm5PVoQ.jpg',
  qingxian: 'https://s41.ax1x.com/2026/08/02/pm5PnWn.jpg',
  weixi: 'https://s41.ax1x.com/2026/08/02/pm5PmJs.jpg',
})

function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex')
}

function hmacHex(key, value) {
  return createHmac('sha256', key).update(value).digest('hex')
}

function formatDate(date = new Date()) {
  return date.toISOString().replace(/[-:.]/g, '').slice(0, 15) + 'Z'
}

export class VolcRealtimeError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'VolcRealtimeError'
    this.code = code
  }
}

export function createVolcRealtimeWssToken(accessKeyId, secretAccessKey, now = new Date()) {
  if (!accessKeyId || !secretAccessKey) {
    throw new VolcRealtimeError('VOLCENGINE_CREDENTIALS_MISSING', '尚未配置火山引擎访问密钥')
  }
  const host = 'visual.volcengineapi.com'
  const endpoint = `https://${host}`
  const region = 'cn-beijing'
  const service = 'cv'
  const action = 'ConnectWebsocket'
  const version = '2022-08-31'
  const xDate = formatDate(now)
  const shortDate = xDate.slice(0, 8)
  const canonicalQuery = canonicalVolcQuery({ Action: action, Version: version })
  const signedHeaders = 'host;x-date'
  const canonicalHeaders = `host:${host}\nx-date:${xDate}`
  const emptyBodyHash = sha256Hex('')
  const canonicalRequest = [
    'GET', '/', canonicalQuery, canonicalHeaders, '', signedHeaders, emptyBodyHash,
  ].join('\n')
  const scope = `${shortDate}/${region}/${service}/request`
  const stringToSign = ['HMAC-SHA256', xDate, scope, sha256Hex(canonicalRequest)].join('\n')
  const kDate = hmacHex(secretAccessKey, shortDate)
  const kRegion = hmacHex(kDate, region)
  const kService = hmacHex(kRegion, service)
  const kSigning = hmacHex(kService, 'request')
  const signature = hmacHex(kSigning, stringToSign)
  const authorization = `HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
  const payload = JSON.stringify({
    url: `${endpoint}?${canonicalQuery}`,
    header: { 'X-Date': xDate, Authorization: authorization, Host: host },
  })
  return Buffer.from(payload, 'utf8').toString('base64')
}

function selectedImage(characterId, requestedImageUrl) {
  if (requestedImageUrl) {
    try {
      const parsed = new URL(requestedImageUrl)
      if (parsed.protocol === 'https:' && !['localhost', '127.0.0.1', '0.0.0.0', '::1'].includes(parsed.hostname)) {
        return parsed.toString()
      }
    } catch {
      // fall through to the configured default below
    }
  }
  return AVATAR_IMAGES[characterId] || process.env.VOLCENGINE_AVATAR_IMAGE_URL || DEFAULT_IMAGE
}

export function createVolcRealtimeProvider({ resolveCredential } = {}) {
  async function createSessionToken(input = {}) {
    const accessKeyId = await resolveCredential('VOLCENGINE_ACCESS_KEY_ID')
    const secretAccessKey = await resolveCredential('VOLCENGINE_SECRET_ACCESS_KEY')
    const wssToken = createVolcRealtimeWssToken(accessKeyId, secretAccessKey)
    return {
      wssToken,
      avatarImageUrl: selectedImage(input.characterId, input.imageUrl),
      expiresAt: Date.now() + 14 * 60 * 1000,
    }
  }

  return {
    id: 'realtime-volc',
    capability: 'avatar-media',
    label: '火山实时数字人 SDK（WSS 令牌）',
    available: () => true,
    capabilities: () => ({ modes: ['realtime-token'] }),
    createSessionToken,
  }
}
