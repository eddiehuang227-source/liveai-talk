/**
 * dsh-live-talk host half.
 *
 * Registers the three Live Talk capability seams and a tiny read-only HTTP
 * surface consumed by the browser half. Every registration is a reversible
 * effect: unloading this plugin removes the routes and services it owns.
 */

import { builtinCharacters } from './core/characters.js'
import { CharacterRegistry } from './core/character-registry.js'
import { ConversationBridge, createFlowactUserMessage } from './core/conversation-bridge.js'
import { DialoguePipeline } from './core/dialogue-pipeline.js'
import { createVideoJobHooks } from './core/video-job-runner.js'
import { createFlowactSeams, SEAMS } from './core/seams.js'
import { createDoubaoAsrProvider } from './providers/asr-doubao.js'
import { createDoubaoTtsProvider } from './providers/tts-doubao.js'
import { createVolcRealtimeProvider, VolcRealtimeError } from './providers/realtime-volc.js'
import { createViduRealtimeProvider, ViduRealtimeError } from './providers/realtime-vidu.js'
import { createJimengProvider, JimengVideoError } from './providers/video-jimeng.js'

export const name = 'live-talk'

/** Required dsh services, all provided by the base/web profiles. */
export const inject = ['webServer', 'agents', 'credentials', 'jobs']

const DEFAULT_CONFIG = Object.freeze({
  title: 'Live Talk',
  defaultCharacter: 'chie',
  providerPolicy: Object.freeze({ tts: 'auto', asr: 'auto', avatarMedia: 'jimeng' }),
})

/**
 * Standard Schema v1 implementation, consumed by the Cordis loader through
 * `Config['~standard'].validate(...)`. Keeping it dependency-free means the
 * plugin works in profiles where only the dsh installation is authoritative;
 * defaults are filled here, so the patch row only overrides what it cares
 * about.
 */
export const Config = Object.freeze({
  '~standard': Object.freeze({
    version: 1,
    vendor: 'dsh-live-talk',
    validate(value) {
      try {
        return { value: normalizeConfig(value) }
      } catch (error) {
        return { issues: [{ message: error instanceof Error ? error.message : String(error) }] }
      }
    },
  }),
})

function normalizeConfig(input = {}) {
  const policy = input.providerPolicy ?? {}
  return {
    title: typeof input.title === 'string' && input.title.trim() ? input.title.trim() : DEFAULT_CONFIG.title,
    defaultCharacter:
      typeof input.defaultCharacter === 'string' && input.defaultCharacter
        ? input.defaultCharacter
        : DEFAULT_CONFIG.defaultCharacter,
    providerPolicy: {
      tts: typeof policy.tts === 'string' && policy.tts ? policy.tts : DEFAULT_CONFIG.providerPolicy.tts,
      asr: typeof policy.asr === 'string' && policy.asr ? policy.asr : DEFAULT_CONFIG.providerPolicy.asr,
      avatarMedia:
        typeof policy.avatarMedia === 'string' && policy.avatarMedia
          ? policy.avatarMedia
          : DEFAULT_CONFIG.providerPolicy.avatarMedia,
    },
  }
}

function sendJson(response, status, value) {
  const body = JSON.stringify(value)
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  })
  response.end(body)
}

function sendText(response, status, contentType, body) {
  response.writeHead(status, {
    'Content-Type': contentType,
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  })
  response.end(body)
}

async function readJsonBody(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > 64 * 1024) throw new Error('REQUEST_TOO_LARGE')
    chunks.push(chunk)
  }
  if (chunks.length === 0) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new Error('INVALID_JSON')
  }
}

export function apply(ctx, rawConfig = {}) {
  const config = normalizeConfig(rawConfig)
  const characters = new CharacterRegistry()
  for (const character of builtinCharacters) characters.register(character)

  const seams = createFlowactSeams()
  const pipeline = {
    analyze(text) {
      const events = []
      const turn = new DialoguePipeline({ emit: (event) => events.push(event) })
      return { summary: turn.replay(text), events }
    },
  }
  const conversation = new ConversationBridge()
  ctx.provide('liveCharacters', characters)
  ctx.provide('liveSeams', seams)
  ctx.provide('liveConfig', config)
  ctx.provide('livePipeline', pipeline)
  ctx.provide('liveConversation', conversation)

  ctx.effect(() => {
    const disposeSessionEvents = ctx.on('session/event', (subject, event) => {
      conversation.handleSessionEvent(subject, event)
    })

    const disposeJobController = ctx.jobs.attachController('live-video')

    const disposeDoubaoTts = seams.tts.register(createDoubaoTtsProvider({
      resolveCredential: async (reference) => (await ctx.credentials.resolve(reference))?.value,
    }))
    const disposeDoubaoAsr = seams.asr.register(createDoubaoAsrProvider({
      resolveCredential: async (reference) => (await ctx.credentials.resolve(reference))?.value,
    }))
    const disposeJimeng = seams.avatarMedia.register(createJimengProvider({
      resolveCredential: async (reference) => (await ctx.credentials.resolve(reference))?.value,
    }))
    const disposeVolcRealtime = seams.avatarMedia.register(createVolcRealtimeProvider({
      resolveCredential: async (reference) => (await ctx.credentials.resolve(reference))?.value,
    }))
    const disposeViduRealtime = seams.avatarMedia.register(createViduRealtimeProvider())

    const disposeHealth = ctx.webServer.register({
      kind: 'exact',
      path: '/live/health',
      handler: (_request, response) => {
        sendJson(response, 200, {
          ok: true,
          plugin: 'dsh-live-talk',
          module: name,
          version: '0.1.0',
          characters: characters.list().length,
          seams: Object.fromEntries(
            Object.entries(SEAMS).map(([key, seam]) => [key, { capability: seam.capability, providers: seams[key].list().length }]),
          ),
        })
      },
    })

    const disposeCharacters = ctx.webServer.register({
      kind: 'exact',
      path: '/live/characters',
      handler: (_request, response) => {
        sendJson(response, 200, {
          title: config.title,
          defaultCharacter: config.defaultCharacter,
          characters: characters.list(),
        })
      },
    })

    const disposeSeams = ctx.webServer.register({
      kind: 'exact',
      path: '/live/seams',
      handler: (_request, response) => {
        sendJson(response, 200, {
          seams: Object.fromEntries(
            Object.entries(SEAMS).map(([key, seam]) => [
              key,
              {
                ...seam,
                providers: seams[key].list().map((provider) => ({ id: provider.id })),
              },
            ]),
          ),
        })
      },
    })

    const disposeAssets = ctx.webServer.register({
      kind: 'prefix',
      path: '/live/assets',
      handler: (_request, response) => {
        sendText(response, 200, 'image/svg+xml', ASSET_SVG)
      },
    })

    const disposePipelineMeta = ctx.webServer.register({
      kind: 'exact',
      path: '/live/pipeline',
      handler: (_request, response) => {
        sendJson(response, 200, {
          events: ['status', 'delta', 'sentence', 'emotion', 'done', 'aborted'],
          minSentenceLen: 20,
          maxSentenceLen: 150,
          capabilities: ['emotion-parse', 'action-parse', 'sentence-split', 'tts-clean'],
        })
      },
    })

    const disposeAnalyze = ctx.webServer.register({
      kind: 'exact',
      path: '/live/analyze',
      handler: async (request, response) => {
        try {
          const body = await readJsonBody(request)
          if (typeof body.text !== 'string' || !body.text.trim()) {
            sendJson(response, 400, { error: 'text must be a non-empty string' })
            return
          }
          sendJson(response, 200, pipeline.analyze(body.text.trim()))
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          sendJson(response, message === 'REQUEST_TOO_LARGE' ? 413 : 400, { error: message })
        }
      },
    })

    const disposeTalk = ctx.webServer.register({
      kind: 'exact',
      path: '/live/talk',
      handler: async (request, response) => {
        try {
          const body = await readJsonBody(request)
          const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : ''
          const text = typeof body.text === 'string' ? body.text.trim() : ''
          if (!sessionId || !text) {
            sendJson(response, 400, { error: 'sessionId and text are required' })
            return
          }
          const agent = ctx.agents.get(sessionId)
          if (!agent) {
            sendJson(response, 404, { error: `no live agent for session "${sessionId}"` })
            return
          }
          agent.followup(createFlowactUserMessage(text))
          sendJson(response, 202, { accepted: true, sessionId })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          sendJson(response, message === 'REQUEST_TOO_LARGE' ? 413 : 400, { error: message })
        }
      },
    })

    const disposeTurn = ctx.webServer.register({
      kind: 'prefix',
      path: '/live/turn',
      handler: (request, response) => {
        const url = new URL(request.url || '/', 'http://127.0.0.1')
        const sessionId = decodeURIComponent(url.pathname.slice('/live/turn/'.length))
        const latest = sessionId ? conversation.latest(sessionId) : null
        if (!latest) {
          sendJson(response, 404, { error: 'no Live Talk turn for this session' })
          return
        }
        sendJson(response, 200, { sessionId, ...latest })
      },
    })

    const resolveMediaProvider = () => seams.avatarMedia.resolve(config.providerPolicy.avatarMedia || 'auto')

    const disposeVideoSubmit = ctx.webServer.register({
      kind: 'exact',
      path: '/live/video/submit',
      handler: async (request, response) => {
        try {
          const body = await readJsonBody(request)
          const provider = resolveMediaProvider()
          const owner = typeof body.sessionId === 'string' ? ctx.agents.get(body.sessionId) || undefined : undefined
          const jobId = ctx.jobs.start({
            kind: 'live-video',
            label: `Live Talk 视频生成 · ${String(body.dialogue || '').slice(0, 24)}`,
            ...(owner ? { owner } : {}),
            run: () => createVideoJobHooks({ provider, input: body }),
          })
          sendJson(response, 202, { accepted: true, jobId })
        } catch (error) {
          if (error instanceof JimengVideoError) {
            sendJson(response, error.status, { error: error.message, code: error.code, requestId: error.requestId })
            return
          }
          const message = error instanceof Error ? error.message : String(error)
          sendJson(response, 502, { error: message })
        }
      },
    })

    const disposeVideoStatus = ctx.webServer.register({
      kind: 'exact',
      path: '/live/video/status',
      handler: async (request, response) => {
        try {
          const body = await readJsonBody(request)
          const provider = resolveMediaProvider()
          const result = await provider.queryVideo(body)
          sendJson(response, 200, result)
        } catch (error) {
          if (error instanceof JimengVideoError) {
            sendJson(response, error.status, { error: error.message, code: error.code, requestId: error.requestId })
            return
          }
          const message = error instanceof Error ? error.message : String(error)
          sendJson(response, 502, { error: message })
        }
      },
    })



    const disposeVolcToken = ctx.webServer.register({
      kind: 'exact',
      path: '/live/realtime/volc-token',
      handler: async (request, response) => {
        try {
          const url = new URL(request.url || '/', 'http://127.0.0.1')
          const provider = seams.avatarMedia.resolve('realtime-volc')
          const token = await provider.createSessionToken({
            characterId: url.searchParams.get('characterId') || '',
            imageUrl: url.searchParams.get('imageUrl') || '',
          })
          sendJson(response, 200, token)
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          const status = error instanceof VolcRealtimeError && error.code === 'VOLCENGINE_CREDENTIALS_MISSING' ? 503 : 500
          sendJson(response, status, { error: message })
        }
      },
    })

    const disposeViduSession = ctx.webServer.register({
      kind: 'exact',
      path: '/live/realtime/vidu/session',
      handler: async (request, response) => {
        try {
          const body = await readJsonBody(request)
          const provider = seams.avatarMedia.resolve('realtime-vidu')
          const session = await provider.createSession(body)
          sendJson(response, 200, session)
        } catch (error) {
          if (error instanceof ViduRealtimeError) {
            sendJson(response, error.status, { error: error.message, code: error.code })
            return
          }
          const message = error instanceof Error ? error.message : String(error)
          sendJson(response, 502, { error: message })
        }
      },
    })

    return () => {
      disposeViduSession()
      disposeVolcToken()
      disposeVideoStatus()
      disposeVideoSubmit()
      disposeViduRealtime()
      disposeVolcRealtime()
      disposeJimeng()
      disposeDoubaoAsr()
      disposeDoubaoTts()
      disposeTurn()
      disposeTalk()
      disposeAnalyze()
      disposePipelineMeta()
      disposeAssets()
      disposeSeams()
      disposeCharacters()
      disposeHealth()
      disposeSessionEvents()
      disposeJobController()
    }
  }, 'live-talk: http surface')
}

/**
 * Placeholder portrait served until character packs replace the bundled SVG
 * assets. It is intentionally generated (no licensed image material) so the
 * bundle stays MIT-clean.
 */
const ASSET_SVG = [
  '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="640" viewBox="0 0 480 640">',
  '<defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">',
  '<stop offset="0" stop-color="#f5d5e6"/><stop offset="1" stop-color="#6f5bd3"/>',
  '</linearGradient></defs>',
  '<rect width="480" height="640" fill="url(#bg)"/>',
  '<circle cx="240" cy="270" r="132" fill="#ffe3d0"/>',
  '<path d="M108 250 Q120 90 240 96 Q360 90 372 250 Q340 200 240 202 Q140 200 108 250Z" fill="#3a2d57"/>',
  '<circle cx="190" cy="270" r="10" fill="#3a2d57"/><circle cx="290" cy="270" r="10" fill="#3a2d57"/>',
  '<path d="M216 320 Q240 340 264 320" stroke="#c46a6a" stroke-width="8" fill="none" stroke-linecap="round"/>',
  '<path d="M150 440 Q240 500 330 440 L330 600 L150 600 Z" fill="#f7f3ff"/>',
  '<text x="240" y="620" text-anchor="middle" font-family="sans-serif" font-size="24" fill="#fff">Live Talk</text>',
  '</svg>',
].join('')
