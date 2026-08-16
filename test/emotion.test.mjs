import test from 'node:test'
import assert from 'node:assert/strict'
import {
  cleanForDisplay,
  cleanForTts,
  parseAction,
  parseEmotion,
} from '../lib/core/emotion.js'

test('parseEmotion prefers the explicit tag over inline prosody tags', () => {
  assert.deepEqual(parseEmotion('[emotion: shy] 你好'), { emotion: 'shy', intensity: 0.9 })
  assert.equal(parseEmotion('哈哈[laughter]').emotion, 'happy')
  assert.equal(parseEmotion('唉[sigh]').emotion, 'tired')
  assert.deepEqual(parseEmotion('普通文本'), { emotion: 'neutral', intensity: 0 })
})

test('parseAction normalizes aliases and returns null without a tag', () => {
  assert.equal(parseAction('[action: wave] 再见'), 'wave')
  assert.equal(parseAction('[action: think] 让我想想'), 'thinking')
  assert.equal(parseAction('没有动作'), null)
})

test('cleanForDisplay removes all tags but keeps punctuation and emoji', () => {
  assert.equal(cleanForDisplay('[emotion: happy][action: nod] 你好！😊'), '你好！😊')
})

test('cleanForTts strips markdown, parentheticals, html, and tags', () => {
  assert.equal(
    cleanForTts('<p>**你好**（挥手）[emotion: happy] 今天见！</p>'),
    '你好 今天见！',
  )
})
