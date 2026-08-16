/**
 * Volcengine visual API HMAC-SHA256 signing, ported from AItalk
 * `lib/volc-signature.ts`. Kept dependency-free so the provider works in the
 * dsh host process; credentials are passed in per operation from
 * `ctx.credentials`.
 */

import { createHash, createHmac } from 'node:crypto'

const VISUAL_HOST = 'visual.volcengineapi.com'
const VISUAL_REGION = 'cn-north-1'
const VISUAL_SERVICE = 'cv'
const VISUAL_VERSION = '2022-08-31'

export class VolcSignatureError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'VolcSignatureError'
    this.code = code
  }
}

function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex')
}

function hmacHex(key, value) {
  return createHmac('sha256', key).update(value).digest('hex')
}

function formatDate(date = new Date()) {
  return date.toISOString().replace(/[-:.]/g, '').slice(0, 15) + 'Z'
}

function encode(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
}

export function canonicalVolcQuery(params) {
  return Object.entries(params)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${encode(key)}=${encode(String(value))}`)
    .join('&')
}

function signingKey(secretAccessKey, shortDate, region, service) {
  const kDate = hmacHex(secretAccessKey, shortDate)
  const kRegion = hmacHex(kDate, region)
  const kService = hmacHex(kRegion, service)
  return hmacHex(kService, 'request')
}

/**
 * Call a Volcengine visual `cv` API with HMAC-signed headers.
 *
 * @param action e.g. `CVSync2AsyncSubmitTask` / `CVSync2AsyncGetResult`
 * @param body provider-owned request payload
 * @param credentials `{ accessKeyId, secretAccessKey }` resolved by the caller
 * @param fetchImpl injectable fetch (tests capture requests)
 */
export async function signedVisualPost(action, body, {
  accessKeyId,
  secretAccessKey,
  fetchImpl = fetch,
} = {}) {
  if (!accessKeyId || !secretAccessKey) {
    throw new VolcSignatureError('VOLCENGINE_CREDENTIALS_MISSING', '尚未配置火山引擎访问密钥')
  }
  const now = new Date()
  const xDate = formatDate(now)
  const shortDate = xDate.slice(0, 8)
  const query = canonicalVolcQuery({ Action: action, Version: VISUAL_VERSION })
  const bodyText = JSON.stringify(body)
  const signedHeaders = 'host;x-date'
  const canonicalRequest = [
    'POST',
    '/',
    query,
    `host:${VISUAL_HOST}\nx-date:${xDate}\n`,
    signedHeaders,
    sha256Hex(bodyText),
  ].join('\n')
  const scope = `${shortDate}/${VISUAL_REGION}/${VISUAL_SERVICE}/request`
  const stringToSign = ['HMAC-SHA256', xDate, scope, sha256Hex(canonicalRequest)].join('\n')
  const signature = hmacHex(
    signingKey(secretAccessKey, shortDate, VISUAL_REGION, VISUAL_SERVICE),
    stringToSign,
  )
  const authorization = `HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`

  return fetchImpl(`https://${VISUAL_HOST}?${query}`, {
    method: 'POST',
    headers: {
      Authorization: authorization,
      'Content-Type': 'application/json',
      'X-Date': xDate,
    },
    body: bodyText,
  })
}
