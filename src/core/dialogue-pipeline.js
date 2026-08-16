/**
 * DialoguePipeline — the provider-independent heart of LiveAI Talk.
 *
 * This is the AItalk streaming coordinator extracted from its WebSocket and
 * vendor code: LLM deltas enter, sentence-aligned stage events leave. Every
 * consumer (TTS provider, clip matcher, archive writer, client renderer) can
 * observe the same deterministic event stream without importing a provider.
 *
 * Event vocabulary (provider-independent, JSON-serializable):
 *   { type: 'delta', text }                        cleaned cumulative display text
 *   { type: 'sentence', raw, text, emotion, action } one flushable TTS unit
 *   { type: 'emotion', emotion, intensity, action } deduplicated stage command
 *   { type: 'done', text }                         turn settled
 *   { type: 'aborted' }                            turn cancelled before settle
 */

import { cleanForDisplay, cleanForTts, parseAction, parseEmotion } from './emotion.js'

const SENTENCE_BREAK = /[。？！；!?;]/g

export function splitStreamingBuffer(buffer, minSentenceLen, maxSentenceLen) {
  const text = buffer.trim()
  if (!text) return null
  const matches = [...text.matchAll(SENTENCE_BREAK)]
  if (matches.length > 0) {
    const end = matches[matches.length - 1].index + matches[matches.length - 1][0].length
    const candidate = text.slice(0, end).trim()
    if (candidate.length >= minSentenceLen || text.length >= maxSentenceLen) {
      return { sentence: candidate, remainder: text.slice(end).trim() }
    }
  } else if (text.length >= maxSentenceLen) {
    return { sentence: text.slice(0, maxSentenceLen).trim(), remainder: text.slice(maxSentenceLen).trim() }
  }
  return null
}

export class DialoguePipeline {
  constructor(options = {}) {
    this.minSentenceLen = options.minSentenceLen ?? 20
    this.maxSentenceLen = options.maxSentenceLen ?? 150
    this.emit = options.emit ?? (() => {})
    this.reset()
  }

  reset() {
    this.phase = 'idle'
    this.buffer = ''
    this.raw = ''
    this.sentences = []
    this.lastEmotion = null
    this.lastAction = null
  }

  beginTurn() {
    this.reset()
    this.phase = 'streaming'
    this.emit({ type: 'status', phase: 'streaming' })
    return this
  }

  applyDelta(delta) {
    if (this.phase !== 'streaming') throw new Error('PIPELINE_NOT_STREAMING')
    this.buffer += delta
    this.raw += delta
    this.emit({ type: 'delta', text: cleanForDisplay(this.raw) })
    for (;;) {
      const split = splitStreamingBuffer(this.buffer, this.minSentenceLen, this.maxSentenceLen)
      if (!split) return this
      this.flushSentence(split.sentence)
      this.buffer = split.remainder
    }
  }

  flushSentence(sentence) {
    if (!sentence.trim()) return
    const raw = sentence.trim()
    const text = cleanForTts(raw)
    const { emotion, intensity } = parseEmotion(raw)
    const action = parseAction(raw)
    this.sentences.push({ raw, text, emotion, action })

    this.emit({ type: 'sentence', raw, text, emotion, action, index: this.sentences.length - 1 })

    // Stage commands are deduplicated at sentence granularity, mirroring the
    // original coordinator so one emotion does not re-trigger a clip per chunk.
    const emotionChanged = emotion !== 'neutral' && emotion !== this.lastEmotion
    const actionChanged = action !== null && action !== this.lastAction
    if (emotionChanged || actionChanged) {
      if (emotionChanged) this.lastEmotion = emotion
      if (actionChanged) this.lastAction = action
      this.emit({
        type: 'emotion',
        emotion: emotionChanged ? emotion : this.lastEmotion ?? 'neutral',
        intensity: emotionChanged ? intensity : 0.6,
        action: actionChanged ? action : this.lastAction,
        sentence: raw.slice(0, 30),
      })
    }
  }

  finishTurn() {
    if (this.phase !== 'streaming') throw new Error('PIPELINE_NOT_STREAMING')
    this.flushSentence(this.buffer)
    this.buffer = ''
    this.phase = 'settled'
    this.emit({ type: 'done', text: cleanForDisplay(this.raw), sentences: this.summary().sentences.length })
    return this.summary()
  }

  abortTurn() {
    const wasStreaming = this.phase === 'streaming'
    this.reset()
    if (wasStreaming) this.emit({ type: 'aborted' })
    return this
  }

  /** Analyze a complete text as one settled turn (replay / offline analysis). */
  replay(text) {
    this.reset()
    this.phase = 'streaming'
    this.raw = String(text ?? '')
    this.buffer = this.raw
    for (;;) {
      const split = splitStreamingBuffer(this.buffer, this.minSentenceLen, this.maxSentenceLen)
      if (!split) break
      this.flushSentence(split.sentence)
      this.buffer = split.remainder
    }
    return this.finishTurn()
  }

  summary() {
    return {
      phase: this.phase,
      text: cleanForDisplay(this.raw),
      sentences: this.sentences.map((sentence) => ({ ...sentence })),
      emotion: this.sentences.map((sentence) => sentence.emotion),
      actions: this.sentences.map((sentence) => sentence.action).filter(Boolean),
    }
  }
}
