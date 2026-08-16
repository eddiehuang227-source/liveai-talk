/**
 * dsh-flowact-avatar browser half.
 *
 * This file is the dsh client-bundle format: a lazy CJS factory registered
 * with `window.__ModuleLoader__.load`. Only platform modules (`react`) are
 * required; the component reaches the host half through the ordinary HTTP
 * route `/flowact/characters`.
 *
 * UI contribution follows dsh slot discipline: one `conversation.view` entry,
 * registered inside `ctx.slots.inject(...)` so the registration waits for the
 * slot declaration and is removed when this plugin unloads.
 */
window.__ModuleLoader__.load({
  id: 'dsh-flowact-avatar',
  factory: (require) => {
    const React = require('react')
    const { createElement, useEffect, useState } = React
    let activeAsrHandle = null

    /** Small client-side TTS seam: providers are replaceable without touching the view. */
    class ClientTtsRuntime {
      constructor() {
        this.providers = new Map()
      }

      register(provider) {
        if (!provider || typeof provider.id !== 'string' || provider.capability !== 'tts') {
          throw new Error('INVALID_TTS_PROVIDER')
        }
        if (this.providers.has(provider.id)) throw new Error('DUPLICATE_TTS_PROVIDER')
        this.providers.set(provider.id, provider)
        return () => this.providers.delete(provider.id)
      }

      list() {
        return [...this.providers.values()].map((provider) => ({
          id: provider.id,
          label: provider.label ?? provider.id,
          available: provider.available?.() !== false,
        }))
      }

      speak(text, options = {}) {
        const requested = options.provider ?? 'auto'
        const usable = this.list().filter((item) => item.available)
        if (requested !== 'auto') {
          const provider = this.providers.get(requested)
          if (!provider || provider.available?.() === false) throw new Error('TTS_PROVIDER_UNAVAILABLE')
          return provider.speak(text, options)
        }
        if (usable.length !== 1) throw new Error('TTS_PROVIDER_AMBIGUOUS')
        return this.providers.get(usable[0].id).speak(text, options)
      }
    }

    const browserTtsProvider = {
      id: 'browser-tts',
      capability: 'tts',
      label: '浏览器语音合成（零 Key）',
      available: () => typeof window !== 'undefined' && Boolean(window.speechSynthesis),
      speak(text, options = {}) {
        if (!this.available()) throw new Error('TTS_PROVIDER_UNAVAILABLE')
        const utterance = new SpeechSynthesisUtterance(String(text))
        const voices = window.speechSynthesis.getVoices()
        if (options.voice) {
          const match = voices.find((voice) => voice.voiceURI === options.voice || voice.name === options.voice)
          if (match) utterance.voice = match
        } else if (voices.length > 0) {
          const zh = voices.find((voice) => voice.lang?.toLowerCase().startsWith('zh'))
          utterance.voice = zh || voices[0]
        }
        if (Number.isFinite(options.rate)) utterance.rate = options.rate
        window.speechSynthesis.speak(utterance)
        return { cancel: () => window.speechSynthesis.cancel() }
      },
    }

      /** Client-side ASR seam mirroring the host `flowactSeams.asr` registry. */
      class ClientAsrRuntime {
        constructor() {
          this.providers = new Map()
        }

        register(provider) {
          if (!provider || typeof provider.id !== 'string' || provider.capability !== 'asr') {
            throw new Error('INVALID_ASR_PROVIDER')
          }
          if (this.providers.has(provider.id)) throw new Error('DUPLICATE_ASR_PROVIDER')
          this.providers.set(provider.id, provider)
          return () => this.providers.delete(provider.id)
        }

        list() {
          return [...this.providers.values()].map((provider) => ({
            id: provider.id,
            label: provider.label ?? provider.id,
            available: provider.available?.() !== false,
          }))
        }

        start(options = {}) {
          const requested = options.provider ?? 'auto'
          const usable = this.list().filter((item) => item.available)
          if (requested !== 'auto') {
            const provider = this.providers.get(requested)
            if (!provider || provider.available?.() === false) throw new Error('ASR_PROVIDER_UNAVAILABLE')
            return provider.start(options)
          }
          if (usable.length !== 1) throw new Error('ASR_PROVIDER_AMBIGUOUS')
          return this.providers.get(usable[0].id).start(options)
        }
      }

      const browserAsrProvider = {
        id: 'browser-speech',
        capability: 'asr',
        label: '浏览器语音识别（零 Key）',
        available: () => typeof window !== 'undefined' && Boolean(window.SpeechRecognition || window.webkitSpeechRecognition),
        start(options = {}) {
          if (!this.available()) throw new Error('ASR_PROVIDER_UNAVAILABLE')
          const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition
          const recognition = new Recognition()
          recognition.lang = options.lang || 'zh-CN'
          recognition.interimResults = false
          recognition.onresult = (event) => {
            const result = event.results?.[event.resultIndex]
            const text = result?.[0]?.transcript ?? ''
            if (text) options.onResult?.(text)
          }
          recognition.onerror = (event) => options.onError?.(event?.error || 'speech-error')
          recognition.onend = () => options.onEnd?.()
          recognition.start()
          return { stop: () => recognition.stop() }
        },
      }


    const VIEW_STYLE = {
      display: 'flex',
      flexDirection: 'column',
      gap: '16px',
      padding: '20px',
      height: '100%',
      overflow: 'auto',
    }
    const GRID_STYLE = {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
      gap: '14px',
    }
    const CARD_STYLE = {
      border: '1px solid var(--dsw-border, rgba(128, 128, 128, 0.25))',
      borderRadius: '12px',
      overflow: 'hidden',
      background: 'var(--dsw-surface, transparent)',
    }
    const IMAGE_STYLE = { width: '100%', aspectRatio: '3 / 4', objectFit: 'cover', display: 'block' }
    const BODY_STYLE = { padding: '12px', display: 'flex', flexDirection: 'column', gap: '6px' }

    function CharacterCard({ character, onSpeak }) {
      return createElement(
        'article',
        { style: CARD_STYLE },
        createElement('img', { src: character.previewUrl, alt: character.name, style: IMAGE_STYLE }),
        createElement(
          'div',
          { style: BODY_STYLE },
          createElement('strong', null, character.name),
          createElement('small', null, character.description),
          createElement(
            'code',
            { style: { fontSize: '11px', opacity: 0.75 } },
            `tts:${character.providers?.tts?.id ?? 'auto'} · media:${character.providers?.avatarMedia?.id ?? 'auto'}`,
          ),
          createElement(
            'button',
            {
              type: 'button',
              onClick: () => onSpeak?.(`你好，我是${character.name}。`),
              style: { alignSelf: 'flex-start', marginTop: '4px' },
            },
            '试听',
          ),
        ),
      )
    }

    function FlowactAvatarView({ speak, useSession, startAsr }) {
      const [state, setState] = useState({ status: 'loading', title: 'FlowAct 数字人', characters: [], error: '' })
      const sessionId = useSession((snapshot) => snapshot.sessionId)
      const [asrState, setAsrState] = useState({ status: 'idle', text: '' })
      const [turnState, setTurnState] = useState(null)

      useEffect(() => {
        if (!sessionId || state.status !== 'ready') return
        let active = true
        let timer
        const poll = async () => {
          try {
            const response = await fetch(`/flowact/turn/${encodeURIComponent(sessionId)}`)
            if (active && response.ok) setTurnState(await response.json())
          } catch {
            // The bridge may not have seen an assistant turn yet.
          } finally {
            if (active) timer = setTimeout(poll, 2000)
          }
        }
        poll()
        return () => {
          active = false
          if (timer) clearTimeout(timer)
        }
      }, [sessionId, state.status])


      function startVoiceInput() {
        try {
          const handle = startAsr({
            onResult: (text) => {
              setAsrState({ status: 'recognized', text })
              if (sessionId && text) {
                fetch('/flowact/talk', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ sessionId, text }),
                }).catch(() => setAsrState((current) => ({ ...current, status: 'send-failed' })))
              }
            },
            onError: (error) => setAsrState({ status: 'error', text: String(error) }),
            onEnd: () => setAsrState((current) => (current.status === 'recognized' ? current : { status: 'ended', text: '' })),
          })
          setAsrState({ status: 'listening', text: '' })
          activeAsrHandle = handle
        } catch (error) {
          setAsrState({ status: 'error', text: error instanceof Error ? error.message : String(error) })
        }
      }


      useEffect(() => {
        let active = true
        fetch('/flowact/characters', { headers: { Accept: 'application/json' } })
          .then(async (response) => {
            if (!response.ok) throw new Error(`HTTP ${response.status}`)
            return response.json()
          })
          .then((payload) => {
            if (active) setState({ status: 'ready', title: payload.title, characters: payload.characters || [], error: '' })
          })
          .catch((error) => {
            if (active) setState({ status: 'error', title: 'FlowAct 数字人', characters: [], error: String(error) })
          })
        return () => {
          active = false
        }
      }, [])

      if (state.status === 'loading') {
        return createElement('div', { style: VIEW_STYLE }, createElement('p', null, '正在读取人物清单…'))
      }
      if (state.status === 'error') {
        return createElement(
          'div',
          { style: VIEW_STYLE },
          createElement('p', null, `人物清单读取失败：${state.error}`),
        )
      }
      return createElement(
        'div',
        { style: VIEW_STYLE },
        createElement('h2', { style: { margin: 0 } }, state.title),
        createElement('p', { style: { margin: 0, opacity: 0.75 } }, '对话角色可视化核心已接入 dsh：人物是 manifest 数据，语音与视频能力经 provider seam 注入。'),
        turnState && Array.isArray(turnState.emotion) && turnState.emotion.length > 0
          ? createElement('p', { style: { margin: 0 } }, `最新语义：情绪 ${turnState.emotion.join(' / ')}${turnState.actions?.length ? ` · 动作 ${turnState.actions.join(' / ')}` : ''}`)
          : null,
        createElement(
          'div',
          { style: { display: 'flex', gap: '8px', alignItems: 'center' } },
          createElement('button', { type: 'button', onClick: startVoiceInput }, '语音输入'),
          createElement('small', { style: { opacity: 0.8 } },
            asrState.status === 'recognized'
              ? `识别结果：${asrState.text}`
              : asrState.status === 'listening'
                ? '正在聆听…'
                : asrState.status === 'error'
                  ? `语音识别不可用：${asrState.text}`
                  : ''),
        ),
        createElement(
          'div',
          { style: GRID_STYLE },
          state.characters.map((character) => createElement(CharacterCard, { key: character.id, character, onSpeak: speak })),
        ),
      )
    }

    function apply(ctx) {
      const tts = new ClientTtsRuntime()
      tts.register(browserTtsProvider)
      ctx.provide('flowactTts', tts)

      const asr = new ClientAsrRuntime()
      asr.register(browserAsrProvider)
      ctx.provide('flowactAsr', asr)

      ctx.slots.inject('conversation.view', () =>
        ctx.slots.register(
          {
            name: 'conversation.view',
            id: 'flowact-avatar',
            order: 20,
            label: 'AI 数字人',
            inject: () => ({
              speak: (text) => tts.speak(text, { provider: 'auto' }),
              startAsr: (options) => asr.start(options),
            }),
            registrant: 'dsh-flowact-avatar',
          },
          FlowactAvatarView,
        ),
      )
    }

    return { name: 'flowact-avatar', inject: ['slots'], apply }
  },
})
