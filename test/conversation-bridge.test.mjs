import test from 'node:test'
import assert from 'node:assert/strict'
import { ConversationBridge, createFlowactUserMessage } from '../lib/core/conversation-bridge.js'

test('createFlowactUserMessage produces a dsh UserMessage wire shape', () => {
  const message = createFlowactUserMessage('你好')
  assert.match(message.id, /^flowact-/)
  assert.equal(message.role, 'user')
  assert.deepEqual(message.content, [{ type: 'text', text: '你好' }])
  assert.deepEqual(message.source, { kind: 'plugin', plugin: 'dsh-flowact-avatar' })
})

test('bridge turns assistant text deltas into a settled pipeline summary', () => {
  const bridge = new ConversationBridge()
  bridge.handleSessionEvent({ id: 's1' }, {
    type: 'assistant/chunk',
    chunk: { type: 'text-delta', text: '[emotion: shy] 那个…' },
  })
  bridge.handleSessionEvent({ id: 's1' }, {
    type: 'assistant/chunk',
    chunk: { type: 'text-delta', text: '其实我也很开心。' },
  })
  bridge.handleSessionEvent({ id: 's1' }, { type: 'assistant/message' })

  const latest = bridge.latest('s1')
  assert.equal(latest.phase, 'settled')
  assert.equal(latest.emotion[0], 'shy')
  assert.equal(latest.sentences.length, 1)
})

test('bridge accepts the live dsh wire shape where chunk lives under data', () => {
  const bridge = new ConversationBridge()
  bridge.handleSessionEvent({ id: 'live-1' }, {
    type: 'assistant/chunk',
    seq: 1,
    time: Date.now(),
    data: { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: '[emotion: happy] 成功了。' } },
  })
  bridge.handleSessionEvent({ id: 'live-1' }, { type: 'assistant/message', data: {} })
  const latest = bridge.latest('live-1')
  assert.equal(latest.phase, 'settled')
  assert.equal(latest.emotion[0], 'happy')
})

test('bridge ignores non-text chunks and keeps sessions isolated', () => {
  const bridge = new ConversationBridge()
  bridge.handleSessionEvent({ id: 's1' }, {
    type: 'assistant/chunk',
    chunk: { type: 'reasoning-delta', text: 'secret thoughts' },
  })
  assert.equal(bridge.latest('s1'), null)

  bridge.handleSessionEvent({ id: 's1' }, {
    type: 'assistant/chunk',
    chunk: { type: 'text-delta', text: '第一句足够长的回复，已经超过阈值了。' },
  })
  bridge.handleSessionEvent({ id: 's2' }, {
    type: 'assistant/chunk',
    chunk: { type: 'text-delta', text: '第二句足够长的回复，也已经超过阈值了。' },
  })
  bridge.handleSessionEvent({ id: 's1' }, { type: 'turn/end' })
  assert.equal(bridge.latest('s1').phase, 'settled')
  assert.equal(bridge.latest('s2').phase, 'streaming')
  bridge.clear('s1')
  assert.equal(bridge.latest('s1'), null)
})
