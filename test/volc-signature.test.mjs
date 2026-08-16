import test from 'node:test'
import assert from 'node:assert/strict'
import { canonicalVolcQuery, signedVisualPost, VolcSignatureError } from '../lib/providers/volc-signature.js'

test('canonicalVolcQuery sorts and encodes like the volcengine canonical form', () => {
  assert.equal(
    canonicalVolcQuery({ Version: '2022-08-31', Action: 'CVSync2AsyncGetResult' }),
    'Action=CVSync2AsyncGetResult&Version=2022-08-31',
  )
  assert.equal(canonicalVolcQuery({ b: '1', a: 'two words' }), 'a=two%20words&b=1')
})

test('signedVisualPost signs the request and posts JSON to the visual endpoint', async () => {
  const calls = []
  const response = { ok: true, status: 200, text: async () => '{}' }
  const fetchImpl = async (url, init) => {
    calls.push({ url, init })
    return response
  }
  const result = await signedVisualPost('CVSync2AsyncGetResult', { task_id: '123' }, {
    accessKeyId: 'AKLT-test',
    secretAccessKey: 'secret-test',
    fetchImpl,
  })
  assert.equal(result, response)
  assert.equal(calls.length, 1)
  const [call] = calls
  assert.match(call.url, /^https:\/\/visual\.volcengineapi\.com\?Action=CVSync2AsyncGetResult&Version=2022-08-31$/)
  assert.equal(call.init.method, 'POST')
  assert.match(call.init.headers.Authorization, /^HMAC-SHA256 Credential=AKLT-test\/\d{8}\/cn-north-1\/cv\/request, SignedHeaders=host;x-date, Signature=[0-9a-f]{64}$/)
  assert.match(call.init.headers['X-Date'], /^\d{8}T\d{6}Z$/)
  assert.equal(call.init.body, JSON.stringify({ task_id: '123' }))
})

test('signedVisualPost fails loud before fetch when credentials are missing', async () => {
  await assert.rejects(
    () => signedVisualPost('CVSync2AsyncGetResult', {}, { fetchImpl: async () => { throw new Error('no') } }),
    (error) => {
      assert.ok(error instanceof VolcSignatureError)
      assert.equal(error.code, 'VOLCENGINE_CREDENTIALS_MISSING')
      return true
    },
  )
})
