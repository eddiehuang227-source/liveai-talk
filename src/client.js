/**
 * dsh-live-talk browser half.
 *
 * This file is the dsh client-bundle format: a lazy CJS factory registered
 * with `window.__ModuleLoader__.load`. Only platform modules (`react`) are
 * required; the component reaches the host half through the ordinary HTTP
 * route `/live/characters`.
 *
 * UI contribution follows dsh slot discipline: one `conversation.view` entry,
 * registered inside `ctx.slots.inject(...)` so the registration waits for the
 * slot declaration and is removed when this plugin unloads.
 */
window.__ModuleLoader__.load({
  id: 'dsh-live-talk',
  factory: (require) => {
    const React = require('react')
    const { createElement, useEffect, useState } = React
    const { Button, Input } = require('@deepseek-ai/dsh-client-ui-primitives')
    let activeAsrHandle = null

    /**
     * Theme is consumed through DSH's semantic aliases only (`--dsw-alias-*`).
     * Writing literal colors here would break the dark scheme and the theme
     * ownership contract in docs/web-styling.
     */
    const PLACEHOLDER_SRC = '/live/assets/placeholder.svg'
    const COLOR_PRIMARY = 'var(--dsw-alias-label-primary)'
    const COLOR_SECONDARY = 'var(--dsw-alias-label-secondary)'
    const COLOR_CAPTION = 'var(--dsw-alias-label-caption)'
    const COLOR_DANGER = 'var(--dsw-alias-state-error-primary)'
    const SURFACE = 'var(--dsw-alias-bg-layer-1)'
    const BORDER = 'var(--dsw-alias-border-l1)'

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

      /** Client-side ASR seam mirroring the host `liveSeams.asr` registry. */
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
      gap: '14px',
      padding: '20px',
      height: '100%',
      overflow: 'auto',
    }
    const GRID_STYLE = {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
      gap: '14px',
    }
    const STAGE_GRID_STYLE = {
      display: 'grid',
      gridTemplateColumns: 'minmax(260px, 360px) minmax(0, 1fr)',
      gap: '14px',
      alignItems: 'start',
    }
    const CARD_STYLE = {
      border: `1px solid ${BORDER}`,
      borderRadius: '12px',
      overflow: 'hidden',
      background: SURFACE,
      cursor: 'pointer',
    }
    const IMAGE_STYLE = { width: '100%', aspectRatio: '3 / 4', objectFit: 'cover', display: 'block' }
    const BODY_STYLE = { padding: '12px', display: 'flex', flexDirection: 'column', gap: '6px' }
    const PANEL_STYLE = {
      border: `1px solid ${BORDER}`,
      borderRadius: '12px',
      padding: '14px',
      display: 'flex',
      flexDirection: 'column',
      gap: '10px',
      background: SURFACE,
    }
    const STAGE_STYLE = {
      position: 'sticky',
      top: '12px',
      border: `1px solid ${BORDER}`,
      borderRadius: '12px',
      overflow: 'hidden',
      background: SURFACE,
    }
    const STAGE_MEDIA_STYLE = { width: '100%', aspectRatio: '3 / 4', objectFit: 'cover', display: 'block' }
    const STAGE_HEADER_STYLE = {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: '8px',
      padding: '10px 12px',
      color: COLOR_PRIMARY,
    }
    const MODE_BAR_STYLE = { display: 'flex', gap: '8px', flexWrap: 'wrap' }
    const FIELD_STYLE = { display: 'flex', flexDirection: 'column', gap: '6px' }

    /** Selected-character stage: opening video, emotion clip, or portrait. */
    function CharacterStage({ character, clip, opening, onOpeningEnd }) {
      const [broken, setBroken] = useState(false)
      useEffect(() => {
        setBroken(false)
      }, [character?.id, clip, opening])
      if (!character) return null
      const poster = broken ? PLACEHOLDER_SRC : character.previewUrl
      let label = '待机'
      let media = null
      if (opening && character.openingVideo && !broken) {
        label = '有声开场预览'
        media = createElement('video', {
          key: 'opening',
          src: character.openingVideo,
          poster,
          controls: true,
          autoPlay: true,
          playsInline: true,
          style: STAGE_MEDIA_STYLE,
          onEnded: onOpeningEnd,
          onError: () => setBroken(true),
        })
      } else if (clip && !broken) {
        label = '情绪片段'
        media = createElement('video', {
          key: clip,
          src: clip,
          poster,
          autoPlay: true,
          muted: true,
          loop: true,
          playsInline: true,
          style: STAGE_MEDIA_STYLE,
          onError: () => setBroken(true),
        })
      } else {
        media = createElement('img', {
          src: poster,
          alt: character.name,
          style: STAGE_MEDIA_STYLE,
          onError: () => setBroken(true),
        })
      }
      return createElement(
        'div',
        { style: STAGE_STYLE },
        createElement(
          'div',
          { style: STAGE_HEADER_STYLE },
          createElement('strong', null, character.name),
          createElement('small', { style: { color: COLOR_CAPTION } }, label),
        ),
        media,
      )
    }

    function CharacterCard({ character, selected, onSelect, onSpeak, onOpening }) {
      const [broken, setBroken] = useState(false)
      useEffect(() => {
        setBroken(false)
      }, [character?.id])
      const cardStyle = selected
        ? { ...CARD_STYLE, borderColor: 'var(--dsw-alias-brand-primary)' }
        : CARD_STYLE
      return createElement(
        'article',
        { style: cardStyle, onClick: onSelect },
        createElement('img', {
          src: broken ? PLACEHOLDER_SRC : character.previewUrl,
          alt: character.name,
          style: IMAGE_STYLE,
          onError: () => setBroken(true),
        }),
        createElement(
          'div',
          { style: BODY_STYLE },
          createElement('strong', { style: { color: COLOR_PRIMARY } }, character.name),
          createElement('small', { style: { color: COLOR_SECONDARY } }, character.description),
          createElement(
            'code',
            { style: { fontSize: '11px', color: COLOR_CAPTION } },
            `tts:${character.providers?.tts?.id ?? 'auto'} · media:${character.providers?.avatarMedia?.id ?? 'auto'}`,
          ),
          createElement(
            'div',
            { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '4px' } },
            createElement(Button, {
              size: 'sm',
              variant: selected ? 'primary' : 'ghost',
              onClick: onSelect,
            }, selected ? '当前角色' : '选择'),
            createElement(Button, { size: 'sm', onClick: () => onSpeak?.(`你好，我是${character.name}。`) }, '试听'),
            character.openingVideo
              ? createElement(Button, { size: 'sm', onClick: onOpening }, '开场')
              : null,
          ),
        ),
      )
    }

    function LiveTalkView({ speak, useSession, startAsr }) {
      const [state, setState] = useState({ status: 'loading', title: 'Live Talk', characters: [], error: '' })
      const [voices, setVoices] = useState([])
      const [voice, setVoice] = useState('zh_female_jiaochuannv_uranus_bigtts')
      const [caps, setCaps] = useState({ providers: {}, credentials: {} })
      const [mode, setMode] = useState('voice')
      const [ttsStatus, setTtsStatus] = useState('')
      const [videoText, setVideoText] = useState('')
      const [videoStatus, setVideoStatus] = useState('')
      const [realtimeStatus, setRealtimeStatus] = useState('')
      const [showSettings, setShowSettings] = useState(false)
      const [settingsDraft, setSettingsDraft] = useState({})
      const [settingsStatus, setSettingsStatus] = useState('')
      const sessionId = useSession((snapshot) => snapshot.sessionId)
      const [asrState, setAsrState] = useState({ status: 'idle', text: '' })
      const [turnState, setTurnState] = useState(null)
      const [selectedId, setSelectedId] = useState(null)
      const [stageClip, setStageClip] = useState(null)
      const [opening, setOpening] = useState(false)

      useEffect(() => {
        let active = true
        Promise.all([
          fetch('/live/characters', { headers: { Accept: 'application/json' } }).then(async (response) => {
            if (!response.ok) throw new Error(`HTTP ${response.status}`)
            return response.json()
          }),
          fetch('/live/voices', { headers: { Accept: 'application/json' } }).then((response) => response.json()),
          fetch('/live/capabilities', { headers: { Accept: 'application/json' } }).then((response) => response.json()),
        ])
          .then(([characters, voicesPayload, capabilitiesPayload]) => {
            if (!active) return
            const list = characters.characters || []
            const preferred = characters.defaultCharacter
            setState({ status: 'ready', title: characters.title, characters: list, error: '' })
            setSelectedId(list.some((character) => character.id === preferred) ? preferred : list[0]?.id ?? null)
            setVoices(voicesPayload.voices || [])
            if (voicesPayload.voices?.[0]) setVoice(voicesPayload.voices[0].id)
            setCaps({ providers: capabilitiesPayload.providers || {}, credentials: capabilitiesPayload.credentials || {} })
          })
          .catch((error) => {
            if (active) setState({ status: 'error', title: 'Live Talk', characters: [], error: String(error) })
          })
        return () => {
          active = false
        }
      }, [])

      useEffect(() => {
        if (!sessionId || state.status !== 'ready') return
        let active = true
        let timer
        const poll = async () => {
          try {
            const response = await fetch(`/live/turn/${encodeURIComponent(sessionId)}`)
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

      const selected = state.characters.find((character) => character.id === selectedId) ?? state.characters[0] ?? null

      useEffect(() => {
        setStageClip(null)
        setOpening(false)
      }, [selectedId])

      useEffect(() => {
        if (!selected || state.status !== 'ready') return
        const sentences = turnState?.sentences ?? []
        const last = sentences[sentences.length - 1]
        const clip = last?.emotion && selected.clips?.[last.emotion]
        setStageClip(clip ?? null)
      }, [turnState, selected?.id])

      const latestEmotion = (() => {
        const sentences = turnState?.sentences ?? []
        return sentences[sentences.length - 1]?.emotion ?? null
      })()

      async function playTts(text) {
        setTtsStatus('正在合成豆包语音…')
        try {
          const response = await fetch('/live/tts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text, voice, speedLevel: 5 }),
          })
          if (response.ok) {
            const blob = await response.blob()
            const url = URL.createObjectURL(blob)
            const audio = new Audio(url)
            audio.onended = () => URL.revokeObjectURL(url)
            await audio.play()
            setTtsStatus(`豆包语音已播放 · ${voice}`)
            return
          }
          const body = await response.json().catch(() => ({}))
          setTtsStatus(`豆包未配置（${body.error || 'fallback'}），已使用浏览器语音`)
          speak?.(text)
        } catch {
          setTtsStatus('豆包未连接，已使用浏览器语音')
          speak?.(text)
        }
      }

      function startVoiceInput() {
        try {
          const handle = startAsr({
            onResult: (text) => {
              setAsrState({ status: 'recognized', text })
              if (sessionId && text) {
                fetch('/live/talk', {
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

      async function submitVideo() {
        if (!videoText.trim()) {
          setVideoStatus('请输入要生成视频的对话文本')
          return
        }
        setVideoStatus('正在提交即梦视频任务…')
        try {
          const response = await fetch('/live/video/submit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              dialogue: videoText.trim(),
              emotion: latestEmotion ?? 'happy',
              characterId: selected?.id ?? 'chie',
              ability: 'v30_1080',
            }),
          })
          const body = await response.json()
          if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`)
          setVideoStatus(`已提交 dsh 后台任务 · ${body.jobId}`)
        } catch (error) {
          setVideoStatus(error instanceof Error ? error.message : String(error))
        }
      }

      async function createVolcToken() {
        setRealtimeStatus('正在签发火山实时数字人凭证…')
        try {
          const response = await fetch(`/live/realtime/volc-token?characterId=${encodeURIComponent(selected?.id ?? 'chie')}`)
          const body = await response.json()
          if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`)
          setRealtimeStatus(`火山实时凭证已就绪，14 分钟内有效 · ${new Date(body.expiresAt).toLocaleTimeString()}`)
        } catch (error) {
          setRealtimeStatus(error instanceof Error ? error.message : String(error))
        }
      }

      async function createViduSession() {
        setRealtimeStatus('正在通过本机代理创建 Vidu S1 会话…')
        try {
          const response = await fetch('/live/realtime/vidu/session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              characterId: selected?.id ?? 'chie',
              persona: selected?.persona ?? '你是一位温柔、自然的中文陪伴助手。',
            }),
          })
          const body = await response.json()
          if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`)
          setRealtimeStatus(`Vidu S1 会话已创建 · liveId=${body.live?.id || body.id || 'ok'}`)
        } catch (error) {
          setRealtimeStatus(error instanceof Error ? error.message : String(error))
        }
      }

      async function saveSettings() {
        setSettingsStatus('正在保存到 dsh 凭据库…')
        try {
          const response = await fetch('/live/settings', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ values: settingsDraft }),
          })
          const body = await response.json()
          if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`)
          setSettingsStatus('已保存到 dsh 凭据库。')
          setShowSettings(false)
          const capsResponse = await fetch('/live/capabilities', { headers: { Accept: 'application/json' } })
          if (capsResponse.ok) {
            const payload = await capsResponse.json()
            setCaps({ providers: payload.providers || {}, credentials: payload.credentials || {} })
          }
        } catch (error) {
          setSettingsStatus(error instanceof Error ? error.message : String(error))
        }
      }


      if (state.status === 'loading') {
        return createElement('div', { style: VIEW_STYLE }, createElement('p', null, '正在读取 Live Talk 工作台…'))
      }
      if (state.status === 'error') {
        return createElement('div', { style: VIEW_STYLE }, createElement('p', null, `工作台读取失败：${state.error}`))
      }

      const providerCards = []
      for (const [capability, providers] of Object.entries(caps.providers)) {
        for (const provider of providers || []) {
          const modes = provider.capabilities?.modes?.join(' / ') || provider.capabilities?.abilities?.join(' / ') || 'registered'
          providerCards.push(
            createElement(
              'div',
              { key: `${capability}-${provider.id}`, style: { display: 'flex', justifyContent: 'space-between', gap: '8px' } },
              createElement('span', { style: { color: COLOR_PRIMARY } }, `${provider.label ?? provider.id} · ${modes}`),
              createElement('small', { style: { color: COLOR_CAPTION } }, capability),
            ),
          )
        }
      }

      const volcTtsReady = Boolean(caps.credentials.VOLC_APP_ID && caps.credentials.VOLC_ACCESS_TOKEN)
      const volcVisualReady = Boolean(caps.credentials.VOLCENGINE_ACCESS_KEY_ID && caps.credentials.VOLCENGINE_SECRET_ACCESS_KEY)

      return createElement(
        'div',
        { style: VIEW_STYLE },
        createElement('h2', { style: { margin: 0 } }, state.title),
        createElement('p', { style: { margin: 0, color: COLOR_SECONDARY } }, 'Animate any photo into a responsive virtual girl. She talks, turns, smiles, and moves naturally in sync with your conversation. Low-lag, high-detail.'),
        createElement(
          'div',
          { style: MODE_BAR_STYLE },
          createElement(Button, { size: 'sm', variant: mode === 'voice' ? 'primary' : 'ghost', onClick: () => setMode('voice') }, '语音对话'),
          createElement(Button, { size: 'sm', variant: mode === 'video' ? 'primary' : 'ghost', onClick: () => setMode('video') }, '视频生成'),
          createElement(Button, { size: 'sm', variant: mode === 'realtime' ? 'primary' : 'ghost', onClick: () => setMode('realtime') }, '实时数字人'),
        ),
        createElement(
          'div',
          { style: STAGE_GRID_STYLE },
          createElement(CharacterStage, {
            character: selected,
            clip: stageClip,
            opening,
            onOpeningEnd: () => setOpening(false),
          }),
          createElement(
            'div',
            { style: GRID_STYLE },
            state.characters.map((character) =>
              createElement(CharacterCard, {
                key: character.id,
                character,
                selected: character.id === selected?.id,
                onSelect: () => setSelectedId(character.id),
                onSpeak: playTts,
                onOpening: () => {
                  setSelectedId(character.id)
                  setStageClip(null)
                  setOpening(true)
                },
              }),
            ),
          ),
        ),
        mode === 'voice'
          ? createElement(
              'div',
              { style: PANEL_STYLE },
              createElement('strong', null, '音色选择'),
              createElement(
                'select',
                {
                  value: voice,
                  onChange: (event) => setVoice(event.target.value),
                  style: {
                    maxWidth: '420px',
                    padding: '6px 8px',
                    borderRadius: '8px',
                    color: COLOR_PRIMARY,
                    background: SURFACE,
                    border: `1px solid ${BORDER}`,
                  },
                },
                voices.map((item) => createElement('option', { key: item.id, value: item.id }, `${item.label} · ${item.id}`)),
              ),
              createElement('small', { style: { color: COLOR_CAPTION } }, volcTtsReady ? '豆包 TTS 已配置，试听会走云端语音。' : '未检测到豆包 TTS 凭据，试听会回退到浏览器语音。'),
              ttsStatus ? createElement('small', { style: { color: COLOR_SECONDARY } }, ttsStatus) : null,
              createElement(
                'div',
                { style: { display: 'flex', gap: '8px', alignItems: 'center' } },
                createElement(Button, { type: 'button', onClick: startVoiceInput }, '语音输入'),
                createElement('small', {
                  style: { color: asrState.status === 'error' ? COLOR_DANGER : COLOR_SECONDARY },
                },
                  asrState.status === 'recognized'
                    ? `识别结果：${asrState.text}`
                    : asrState.status === 'listening'
                      ? '正在聆听…'
                      : asrState.status === 'error'
                        ? `语音识别不可用：${asrState.text}`
                        : ''),
              ),
              turnState && Array.isArray(turnState.emotion) && turnState.emotion.length > 0
                ? createElement('p', { style: { margin: 0, color: COLOR_PRIMARY } }, `最新语义：情绪 ${turnState.emotion.join(' / ')}${turnState.actions?.length ? ` · 动作 ${turnState.actions.join(' / ')}` : ''}`)
                : null,
            )
          : null,
        mode === 'video'
          ? createElement(
              'div',
              { style: PANEL_STYLE },
              createElement('strong', null, '即梦视频生成（火山引擎）'),
              createElement('label', { style: FIELD_STYLE }, createElement('span', null, '对话文本'), createElement('textarea', {
                rows: 3,
                value: videoText,
                onChange: (event) => setVideoText(event.target.value),
                placeholder: '输入一句角色要说的台词',
                style: {
                  padding: '8px',
                  borderRadius: '8px',
                  color: COLOR_PRIMARY,
                  background: SURFACE,
                  border: `1px solid ${BORDER}`,
                },
              })),
              createElement(Button, { type: 'button', onClick: submitVideo, style: { alignSelf: 'flex-start' } }, '提交视频生成'),
              createElement('small', { style: { color: COLOR_CAPTION } }, volcVisualReady ? '火山引擎访问密钥已配置。' : '未配置火山引擎访问密钥，提交后任务会在 dsh jobs 中记录失败原因。'),
              videoStatus ? createElement('small', { style: { color: COLOR_SECONDARY } }, videoStatus) : null,
            )
          : null,
        mode === 'realtime'
          ? createElement(
              'div',
              { style: PANEL_STYLE },
              createElement('strong', null, '实时数字人通道'),
              createElement(Button, { type: 'button', onClick: createVolcToken, style: { alignSelf: 'flex-start' } }, '获取火山实时数字人凭证'),
              createElement(Button, { type: 'button', onClick: createViduSession, style: { alignSelf: 'flex-start' } }, '创建 Vidu S1 实时会话'),
              createElement('small', { style: { color: COLOR_CAPTION } }, '火山 SDK 令牌有效期 14 分钟；Vidu Key 由你的本机 18088 代理持有。'),
              realtimeStatus ? createElement('small', { style: { color: COLOR_SECONDARY } }, realtimeStatus) : null,
            )
          : null,
        createElement(
          'div',
          { style: PANEL_STYLE },
          createElement('strong', null, '能力状态'),
          providerCards.length > 0 ? providerCards : createElement('small', null, '正在读取 provider 能力…'),
          createElement('small', { style: { color: COLOR_CAPTION } }, `豆包语音：${volcTtsReady ? '已配置' : '未配置'} · 火山视觉/实时：${volcVisualReady ? '已配置' : '未配置'}`),
        ),
        createElement(
          'div',
          { style: PANEL_STYLE },
          createElement('strong', null, '豆包 / 火山密钥配置'),
          createElement('small', { style: { color: COLOR_CAPTION } }, '保存到 dsh 凭据库（ctx.credentials），不会进入仓库或页面代码。大模型请在 dsh 设置 → Models 选择。'),
          createElement(Button, { type: 'button', onClick: () => setShowSettings((value) => !value), style: { alignSelf: 'flex-start' } }, showSettings ? '收起配置' : '展开配置'),
          showSettings
            ? createElement(
                'div',
                { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '10px' } },
                ...[
                  ['VOLC_APP_ID', '豆包 App ID', false],
                  ['VOLC_ACCESS_TOKEN', '豆包 Access Token', true],
                  ['VOLCENGINE_ACCESS_KEY_ID', '火山 Access Key ID', false],
                  ['VOLCENGINE_SECRET_ACCESS_KEY', '火山 Secret Access Key', true],
                ].map(([key, label, secret]) =>
                  createElement(
                    'label',
                    { key, style: FIELD_STYLE },
                    createElement('span', null, `${label} ${caps.credentials[key] ? '· 已配置' : ''}`),
                    createElement(Input, {
                      type: secret ? 'password' : 'text',
                      autoComplete: 'off',
                      placeholder: secret ? '仅修改时填写' : label,
                      value: settingsDraft[key] || '',
                      onChange: (event) => setSettingsDraft((current) => ({ ...current, [key]: event.target.value })),
                    }),
                  ),
                ),
                createElement(Button, { type: 'button', onClick: saveSettings, style: { alignSelf: 'end' } }, '保存密钥'),
              )
            : null,
          settingsStatus ? createElement('small', { style: { color: COLOR_SECONDARY } }, settingsStatus) : null,
        ),
      )
    }


    function apply(ctx) {
      const tts = new ClientTtsRuntime()
      tts.register(browserTtsProvider)
      ctx.provide('liveTts', tts)

      const asr = new ClientAsrRuntime()
      asr.register(browserAsrProvider)
      ctx.provide('liveAsr', asr)

      ctx.slots.inject('conversation.view', () =>
        ctx.slots.register(
          {
            name: 'conversation.view',
            id: 'live-talk',
            order: 20,
            label: 'Live Talk',
            inject: () => ({
              speak: (text) => tts.speak(text, { provider: 'auto' }),
              startAsr: (options) => asr.start(options),
            }),
            registrant: 'dsh-live-talk',
          },
          LiveTalkView,
        ),
      )
    }

    return { name: 'live-talk', inject: ['slots'], apply }
  },
})
