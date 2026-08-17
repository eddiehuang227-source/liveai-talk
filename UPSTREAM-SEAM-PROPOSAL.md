# Upstream proposal: standard ASR / TTS / avatar-media capability seams for dsh

Status: submitted to `deepseek-ai/deepseek-harness` Discussions → Ideas (2026-08).

## Motivation

DeepSeek Harness already has excellent seams for `llm`, `web`, `fs`, `subprocess`,
`jobs`, and the UI slot system. Conversational-avatar experiences add three more
capabilities that are currently re-implemented by every downstream plugin:

- **ASR** — microphone PCM in, transcript out;
- **TTS** — text in, streamable audio out;
- **avatar-media** — character clips, dialogue-video generation, and realtime
  avatar sessions.

`dsh-live-talk` proves the shape works: it defines these three seams and
ships seven interchangeable providers (Doubao ASR/TTS, browser speech, Jimeng
video, Volcengine/Vidu realtime). If dsh owns the Service Definition, the
whole ecosystem can share providers instead of each plugin inventing its own
registry.

## Proposed packages

Follow the existing dsh capability-seam split: Service Definition, Service
Provider, Consumer.

```text
packages/speech/asr/            ctx.asr — AsrProvider registry
packages/speech/tts/            ctx.tts — TtsProvider registry
packages/media/avatar-media/    ctx.avatarMedia — AvatarMediaProvider registry
```

Provider examples:
- `asr-doubao` / `asr-sensevoice` / `asr-browser`
- `tts-doubao` / `tts-browser` / OpenAI-compatible TTS gateways
- `avatar-media-jimeng` / `avatar-media-vidu` / `avatar-media-volc`

## Contracts (first draft)

```ts
interface AsrProvider {
  readonly id: string
  available(): boolean
  transcribe(pcm: Float32Array, opts: { sampleRate: number; signal?: AbortSignal }):
    Promise<{ text: string; engine: string; latencyMs: number }>
}

interface TtsProvider {
  readonly id: string
  available(): boolean
  listVoices(): VoiceInfo[]
  synthesize(text: string, opts: { voice?: string; rate?: number }):
    AsyncIterable<Uint8Array> // 24 kHz s16le PCM frames
}

interface AvatarMediaProvider {
  readonly id: string
  available(): boolean
  capabilities(): { modes: ('clip' | 'video-gen' | 'realtime-token' | 'realtime-live')[] }
  submitVideo?(req: VideoRequest): Promise<VideoTask>
  queryVideo?(task: VideoTask): Promise<VideoQueryResult>
  createSessionToken?(req: RealtimeTokenRequest): Promise<RealtimeTokenResult>
  createSession?(req: RealtimeSessionRequest): Promise<RealtimeSessionResult>
}
```

The video generation path should integrate with `ctx.jobs`, exactly like
`dsh-live-talk` does with the `live-video` job kind.

## Design constraints learned from Live Talk

1. **Credentials belong to `ctx.credentials`, not provider config.** Live Talk
   resolves `VOLC_*` references per operation, so key rotation reaches the next
   call without restart.
2. **Binary audio must stay binary.** Do not force PCM through JSON-RPC; a
   `ctx.webServer.registerUpgrade` WebSocket or a streamable byte channel keeps
   realtime latency acceptable.
3. **Provider selection must not depend on registration order.** Live Talk uses
   the dsh web-seam semantics: explicit id, else exactly-one-available, else
   loud `AMBIGUOUS`.
4. **Vendor quirks stay inside providers.** Doubao frame codecs, Volcengine
   HMAC, Vidu proxy handshakes, and rate-limit mappings are all provider
   internals in Live Talk; the core only sees normalized events.

## Migration path

1. Land the three Service Definition packages in dsh.
2. Move the codecs and providers from `dsh-live-talk` into official
   provider packages, leaving Live Talk as the Consumer/UI.
3. Register browser speech providers as zero-key defaults so a fresh dsh
   profile can speak/transcribe without any vendor account.

## Links

- Implementation reference:
  <https://github.com/eddiehuang227-source/live-talk>
- dsh architecture: capability seams
  (`docs/architecture.md` in `deepseek-ai/deepseek-harness`)
