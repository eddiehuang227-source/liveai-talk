import test from 'node:test'
import assert from 'node:assert/strict'
import { DialoguePipeline, splitStreamingBuffer } from '../lib/core/dialogue-pipeline.js'

test('splitStreamingBuffer holds short sentences and flushes at the sentence break', () => {
  const short = splitStreamingBuffer('你好', 20, 150)
  assert.equal(short, null)

  const ready = splitStreamingBuffer('这是一句足够长的回复，今天也一起加油吧。', 20, 150)
  assert.equal(ready.sentence, '这是一句足够长的回复，今天也一起加油吧。')
  assert.equal(ready.remainder, '')
})

test('splitStreamingBuffer enforces the hard ceiling when no break arrives', () => {
  const split = splitStreamingBuffer('一'.repeat(160), 20, 150)
  assert.equal(split.sentence.length, 150)
  assert.equal(split.remainder.length, 10)
})

test('pipeline emits sentence-aligned emotion and action events', () => {
  const events = []
  const pipeline = new DialoguePipeline({ emit: (event) => events.push(event) })
  pipeline.beginTurn()
  pipeline.applyDelta('[emotion: happy][action: wave] 太好了，我们出发吧。')
  pipeline.applyDelta(' 路上小心。')
  const summary = pipeline.finishTurn()

  assert.equal(summary.sentences.length, 2)
  assert.deepEqual(summary.emotion, ['happy', 'neutral'])
  assert.deepEqual(summary.actions, ['wave'])
  assert.ok(events.some((event) => event.type === 'sentence' && event.action === 'wave'))
  assert.ok(events.some((event) => event.type === 'emotion' && event.emotion === 'happy'))
  assert.equal(events.at(-1).type, 'done')
})

test('pipeline cleans TTS text without leaking display tags', () => {
  const pipeline = new DialoguePipeline({ emit: () => {} })
  const summary = pipeline.replay('[emotion: shy] 那个…（小声）**其实我也很开心。**')
  assert.equal(summary.sentences[0].text, '那个…其实我也很开心。')
  assert.equal(summary.sentences[0].emotion, 'shy')
  assert.equal(summary.text, '那个…（小声）**其实我也很开心。**')
})

test('duplicate stage commands are deduplicated per turn', () => {
  const events = []
  const pipeline = new DialoguePipeline({ emit: (event) => events.push(event) })
  pipeline.replay('[emotion: happy] 今天真开心。 [emotion: happy] 明天也要开心。')
  const emotionEvents = events.filter((event) => event.type === 'emotion' && event.emotion === 'happy')
  assert.equal(emotionEvents.length, 1)
})

test('abort resets a streaming turn and emits aborted', () => {
  const events = []
  const pipeline = new DialoguePipeline({ emit: (event) => events.push(event) })
  pipeline.beginTurn()
  pipeline.applyDelta('还没说完')
  pipeline.abortTurn()
  assert.equal(pipeline.phase, 'idle')
  assert.equal(events.at(-1).type, 'aborted')
  assert.throws(() => pipeline.finishTurn(), /PIPELINE_NOT_STREAMING/)
})
