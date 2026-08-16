/**
 * Provider-independent semantic parsing extracted from the AItalk
 * voice coordinator. This module owns the character-visualization vocabulary:
 * the LLM emits `[emotion: ...]` / `[action: ...]` tags and this core turns
 * them into stage commands without knowing which TTS, video, or realtime
 * provider will consume them.
 */

const EMOTION_TAG = /\[emotion:\s*(\w+)\]/
const ACTION_TAG = /\[action:\s*(\w+)\]/

/**
 * Inline prosody tags found in real LLM output. Order is irrelevant: the
 * highest intensity wins, so a single utterance cannot flip-flop between
 * several weak emotions.
 */
const INLINE_EMOTION_MAP = new Map([
  ['[laughter]', ['happy', 0.7]],
  ['[laugh]', ['happy', 0.6]],
  ['[sigh]', ['tired', 0.4]],
  ['[breath]', ['neutral', 0.2]],
  ['[quick_breath]', ['excited', 0.5]],
  ['[mn]', ['thinking', 0.3]],
  ['[mm]', ['thinking', 0.3]],
  ['[clucking]', ['thinking', 0.3]],
  ['[lipsmack]', ['thinking', 0.2]],
  ['[noise]', ['surprise', 0.3]],
  ['[hissing]', ['angry', 0.5]],
  ['[cough]', ['neutral', 0.2]],
  ['[yawn]', ['tired', 0.4]],
])

const ACTION_MAP = new Map([
  ['nod', 'nod'],
  ['shake', 'shake'],
  ['tilt', 'tilt'],
  ['shrug', 'shrug'],
  ['wave', 'wave'],
  ['lean', 'lean'],
  ['stretch', 'stretch'],
  ['look_away', 'look_away'],
  ['thinking', 'thinking'],
  ['think', 'thinking'],
])

/** Parse the highest-priority emotion label and an intensity in 0..1. */
export function parseEmotion(text) {
  if (typeof text !== 'string') return { emotion: 'neutral', intensity: 0 }
  const tagged = text.match(EMOTION_TAG)
  if (tagged) return { emotion: tagged[1], intensity: 0.9 }

  let bestEmotion = 'neutral'
  let bestIntensity = 0
  for (const [tag, [emotion, intensity]] of INLINE_EMOTION_MAP) {
    if (text.includes(tag) && intensity > bestIntensity) {
      bestEmotion = emotion
      bestIntensity = intensity
    }
  }
  return { emotion: bestEmotion, intensity: bestIntensity }
}

/** Parse an explicit `[action: ...]` tag into a normalized stage action. */
export function parseAction(text) {
  if (typeof text !== 'string') return null
  const tagged = text.match(ACTION_TAG)
  if (!tagged) return null
  return ACTION_MAP.get(tagged[1].toLowerCase()) || tagged[1].toLowerCase()
}

const EMOJI = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{200D}]/gu
const DISPLAY_TAGS = /\[[\w\s:]+\]/g

/** Strip all `[tag]` syntax for chat display; emoji are preserved. */
export function cleanForDisplay(text) {
  if (typeof text !== 'string') return ''
  return text.replace(DISPLAY_TAGS, '').replace(/\s+/g, ' ').trim()
}

/**
 * Make text safe for a generic TTS provider: remove markdown, parenthetical
 * action descriptions, html tags, and emoji. Provider-specific tag mapping
 * (for example Doubao PCM path) belongs in the TTS provider, not here.
 */
export function cleanForTts(text) {
  if (typeof text !== 'string') return ''
  let cleaned = text
  cleaned = cleaned.replace(/<[^>]+>/g, '')
  // Unwrap bold/italic instead of dropping the emphasized words, then remove
  // any unmatched markers left by a sentence boundary inside the markup.
  cleaned = cleaned.replace(/\*{1,2}([^*]+)\*{1,2}/g, '$1')
  cleaned = cleaned.replace(/\*+/g, '')
  cleaned = cleaned.replace(/\s*[（(][^）)]*[）)]\s*/g, '')
  cleaned = cleaned.replace(/^#{1,6}\s+/gm, '')
  cleaned = cleaned.replace(/^[-*]\s+/gm, '')
  cleaned = cleaned.replace(/^\d+\.\s+/gm, '')
  cleaned = cleaned.replace(EMOJI, '')
  cleaned = cleaned.replace(DISPLAY_TAGS, '')
  cleaned = cleaned.replace(/\s+/g, ' ')
  return cleaned.trim()
}
