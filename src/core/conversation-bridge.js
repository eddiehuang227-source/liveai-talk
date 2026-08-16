/**
 * ConversationBridge — connects the dsh session event log to the Live Talk
 * dialogue pipeline.
 *
 * The dsh agent loop already owns model routing, history, tools, and
 * persistence. This bridge consumes its `session/event` stream (`assistant/
 * chunk` text deltas → `assistant/message` settle), feeds the provider-
 * independent DialoguePipeline, and exposes the latest stage summary per
 * session. No provider code lives here.
 */

import { randomUUID } from 'node:crypto'
import { DialoguePipeline } from './dialogue-pipeline.js'

/** Build a dsh UserMessage without importing dsh-llm at the wire boundary. */
export function createFlowactUserMessage(text) {
  return {
    id: `live-${randomUUID()}`,
    role: 'user',
    content: [{ type: 'text', text: String(text ?? '') }],
    source: { kind: 'plugin', plugin: 'dsh-live-talk' },
  }
}

export class ConversationBridge {
  constructor(options = {}) {
    this.pipelineOptions = options.pipelineOptions ?? {}
    this.turns = new Map()
  }

  handleSessionEvent(subject, event) {
    if (typeof event?.type !== 'string') return
    const sessionId = typeof subject?.id === 'string' ? subject.id : String(subject?.id ?? '')
    if (!sessionId) return

    // dsh session events carry their payload under `data`: the live wire shape
    // is `{ type, seq, time, data: { turn, step, chunk } }`, while replayed
    // fixtures are sometimes flattened to `{ type, chunk }`. Accept both.
    const chunk = event.chunk ?? event.data?.chunk
    if (event.type === 'assistant/chunk' && chunk?.type === 'text-delta') {
      let turn = this.turns.get(sessionId)
      if (!turn) {
        const events = []
        turn = {
          events,
          pipeline: new DialoguePipeline({
            ...this.pipelineOptions,
            emit: (item) => events.push(item),
          }),
        }
        this.turns.set(sessionId, turn)
        turn.pipeline.beginTurn()
      }
      turn.pipeline.applyDelta(chunk.text)
      return { sessionId, phase: turn.pipeline.phase, summary: turn.pipeline.summary() }
    }

    if (event.type === 'assistant/message' || event.type === 'turn/end') {
      const turn = this.turns.get(sessionId)
      if (!turn) return { sessionId, phase: 'idle', summary: null }
      let summary
      if (turn.pipeline.phase === 'streaming') summary = turn.pipeline.finishTurn()
      else summary = turn.pipeline.summary()
      turn.summary = summary
      return { sessionId, phase: 'settled', summary }
    }

    return { sessionId, phase: this.turns.get(sessionId)?.pipeline.phase ?? 'idle', summary: this.turns.get(sessionId)?.summary ?? null }
  }

  latest(sessionId) {
    const turn = this.turns.get(sessionId)
    if (!turn) return null
    return turn.summary ?? turn.pipeline.summary()
  }

  clear(sessionId) {
    this.turns.delete(sessionId)
  }
}
