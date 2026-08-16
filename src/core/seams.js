/**
 * LiveAI Talk capability seams.
 *
 * Each seam has three roles, following the DeepSeek Harness architecture:
 *   - Service Definition: the registry/contract in this package;
 *   - Service Provider: a plugin registering one or more providers;
 *   - Consumer: the dialogue pipeline / client stage using the registry.
 *
 * Provider contracts are intentionally small for the first slice. Streaming
 * and binary audio contracts are added when the first real provider lands.
 */

import { ProviderRegistry } from './provider-registry.js'

export const SEAMS = Object.freeze({
  asr: {
    capability: 'asr',
    description: 'speech-to-text: PCM audio in, transcript + engine metadata out',
  },
  tts: {
    capability: 'tts',
    description: 'text-to-speech: text in, streamable PCM/audio frames out',
  },
  avatarMedia: {
    capability: 'avatar-media',
    description: 'character visuals: clips, dialogue-video generation, realtime avatar sessions',
  },
})

/**
 * ASR provider contract (documentation-only until the doubao provider lands):
 *   transcribe(input, options) -> Promise<{ text, engine, latencyMs }>
 * TTS provider contract:
 *   listVoices() -> VoiceInfo[]
 *   synthesize(text, options) -> AsyncIterable<ArrayBuffer>
 * AvatarMedia provider contract:
 *   capabilities() -> { modes: string[], ... }
 *   submitVideo(request) -> Promise<{ taskId }>
 *   queryVideo(task) -> Promise<{ status, url? }>
 */

export function createFlowactSeams() {
  return {
    asr: new ProviderRegistry(SEAMS.asr.capability),
    tts: new ProviderRegistry(SEAMS.tts.capability),
    avatarMedia: new ProviderRegistry(SEAMS.avatarMedia.capability),
  }
}
