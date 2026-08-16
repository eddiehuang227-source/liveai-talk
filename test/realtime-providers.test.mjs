import test from 'node:test'
import assert from 'node:assert/strict'
import { createVolcRealtimeProvider, createVolcRealtimeWssToken, VolcRealtimeError } from '../lib/providers/realtime-volc.js'
import { createViduRealtimeProvider, ViduRealtimeError } from '../lib/providers/realtime-vidu.js'

test('volc realtime token signing produces the ConnectWebsocket payload', () => {
  const token = createVolcRealtimeWssToken('ak', 'sk', new Date('2026-08-16T00:00:00Z'))
  const payload = JSON.parse(Buffer.from(token, 'base64').toString('utf8'))
  assert.equal(payload.url, 'https://visual.volcengineapi.com?Action=ConnectWebsocket&Version=2022-08-31')
  assert.equal(payload.header.Host, 'visual.volcengineapi.com')
  assert.match(payload.header['X-Date'], /^20260816T000000Z$/)
  assert.match(payload.header.Authorization, /^HMAC-SHA256 Credential=ak\/20260816\/cn-beijing\/cv\/request/)
})

test('volc realtime provider resolves credentials and rejects missing keys', async () => {
  const provider = createVolcRealtimeProvider({ resolveCredential: async (name) => (name === 'VOLCENGINE_ACCESS_KEY_ID' ? 'ak' : 'sk') })
  const token = await provider.createSessionToken({ characterId: 'chie' })
  assert.ok(token.wssToken)
  assert.equal(token.avatarImageUrl, 'https://s41.ax1x.com/2026/08/02/pm5PQyV.jpg')

  const missing = createVolcRealtimeProvider({ resolveCredential: async () => undefined })
  await assert.rejects(
    () => missing.createSessionToken({ characterId: 'chie' }),
    (error) => error instanceof VolcRealtimeError && error.code === 'VOLCENGINE_CREDENTIALS_MISSING',
  )
})

test('vidu provider creates a live session through the local key-holding proxy', async () => {
  const calls = []
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init })
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ live: { id: 'live-1' }, rtc: { token: 'rtc-token' } }),
    }
  }
  const provider = createViduRealtimeProvider({ proxyBase: 'http://127.0.0.1:18088/proxy/cn', fetchImpl })
  const session = await provider.createSession({ characterId: 'chie', persona: '测试人格' })
  assert.equal(session.live.id, 'live-1')
  assert.equal(calls.length, 1)
  assert.match(calls[0].url, /\/live\/v1\/lives$/)
  const body = JSON.parse(calls[0].init.body)
  assert.equal(body.call_mode, 'audio')
  assert.equal(body.avatar.persona, '测试人格')
  assert.equal(body.avatar.name, '星之宫知惠')
  assert.equal(body.avatar.voice, 'Tina')
})

test('vidu provider rejects unsupported characters and unreachable proxies', async () => {
  const provider = createViduRealtimeProvider({ fetchImpl: async () => { throw new Error('no fetch') } })
  await assert.rejects(
    () => provider.createSession({ characterId: 'custom-unknown', persona: '' }),
    (error) => error instanceof ViduRealtimeError && error.code === 'VIDU_UNSUPPORTED_CHARACTER' && error.status === 400,
  )
  await assert.rejects(
    () => provider.createSession({ characterId: 'chie' }),
    (error) => error instanceof ViduRealtimeError && error.code === 'VIDU_PROXY_UNREACHABLE',
  )
})
