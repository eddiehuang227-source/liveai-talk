/**
 * `jimeng` — Volcengine Jimeng dialogue-video provider for the host Live Talk
 * `avatar-media` seam. Ported from AItalk `app/api/video-submit/route.ts` and
 * `app/api/video-status/route.ts`.
 *
 * Credentials are resolved per operation through dsh `ctx.credentials`
 * (`VOLCENGINE_ACCESS_KEY_ID` / `VOLCENGINE_SECRET_ACCESS_KEY`). The optional
 * default image URL is not a secret and is read from the process environment.
 */

import { signedVisualPost, VolcSignatureError } from './volc-signature.js'

const DEFAULT_IMAGE = 'https://s41.ax1x.com/2026/08/02/pm5PQyV.jpg'

export const JIMENG_ABILITIES = Object.freeze({
  v30_720: { reqKey: 'jimeng_i2v_first_tail_v30', imageCount: 2 },
  v30_1080: { reqKey: 'jimeng_i2v_first_tail_v30_1080', imageCount: 2 },
  v30_pro_1080: { reqKey: 'jimeng_ti2v_v30_pro', imageCount: 1 },
})

export class JimengVideoError extends Error {
  constructor(code, message, details = {}) {
    super(message)
    this.name = 'JimengVideoError'
    this.code = code
    this.upstreamCode = details.code
    this.requestId = details.requestId
    this.status = details.status ?? 502
  }
}

function selectedImageUrl(value) {
  const raw = value || process.env.VOLCENGINE_AVATAR_IMAGE_URL || DEFAULT_IMAGE
  let url
  try {
    url = new URL(raw)
  } catch {
    throw new JimengVideoError('INVALID_IMAGE_URL', '图片必须是可公开访问的 HTTPS 地址', { status: 400 })
  }
  const forbiddenHost = url.hostname === 'localhost'
    || url.hostname === '127.0.0.1'
    || url.hostname === '0.0.0.0'
    || url.hostname === '::1'
    || /^10\./.test(url.hostname)
    || /^192\.168\./.test(url.hostname)
    || /^172\.(1[6-9]|2\d|3[01])\./.test(url.hostname)
  if (url.protocol !== 'https:' || forbiddenHost) {
    throw new JimengVideoError('INVALID_IMAGE_URL', '图片必须是可公开访问的 HTTPS 地址，且不能指向本机或内网', { status: 400 })
  }
  return url.toString()
}

function videoPrompt(dialogue, emotion, motion) {
  const safeDialogue = dialogue.replace(/[\r\n]+/g, ' ').slice(0, 260)
  const safeEmotion = emotion.replace(/[^\w\u4e00-\u9fff-]/g, '').slice(0, 24) || '温柔自然'
  const safeMotion = motion?.replace(/[\r\n]+/g, ' ').slice(0, 220) || '轻微点头，嘴唇自然开合'
  return [
    `同一位女性角色面对镜头，以${safeEmotion}的情绪完成一段自然连贯的动作。`,
    `动作要求：${safeMotion}。`,
    `对话内容是：“${safeDialogue}”。`,
    '镜头稳定，动作流畅，避免多余手指和肢体变形，保持人物身份、五官、发型、服装与背景完全一致。',
  ].join('')
}

async function parseVisualJson(response) {
  const text = await response.text()
  let body = {}
  try {
    body = text ? JSON.parse(text) : {}
  } catch {
    body = { message: text.slice(0, 300) }
  }
  return { ok: response.ok, status: response.status, body }
}

export function createJimengProvider({
  resolveCredential,
  signedPost = signedVisualPost,
  fetchImpl,
} = {}) {
  const tasks = new Map()

  async function credentials() {
    const accessKeyId = await resolveCredential('VOLCENGINE_ACCESS_KEY_ID')
    const secretAccessKey = await resolveCredential('VOLCENGINE_SECRET_ACCESS_KEY')
    return { accessKeyId, secretAccessKey }
  }

  async function submitVideo(input = {}) {
    const dialogue = String(input.dialogue ?? '').trim()
    if (!dialogue) throw new JimengVideoError('DIALOGUE_REQUIRED', '对话文本不能为空', { status: 400 })
    if (dialogue.length > 500) throw new JimengVideoError('DIALOGUE_TOO_LONG', '对话文本不能超过 500 字', { status: 400 })
    if (input.motion && String(input.motion).length > 300) {
      throw new JimengVideoError('MOTION_TOO_LONG', '动作描述不能超过 300 字', { status: 400 })
    }

    const emotion = String(input.emotion || '温柔').trim()
    const frames = input.frames === 241 ? 241 : 121
    const prompt = videoPrompt(dialogue, emotion, input.motion)
    const imageUrl = selectedImageUrl(input.imageUrl)
    const abilityKey = input.ability && JIMENG_ABILITIES[input.ability] ? input.ability : 'v30_1080'
    const ability = JIMENG_ABILITIES[abilityKey]
    const characterId = /^(chie|mahiru|miyuki|rin|custom-[a-z0-9-]{6,48})$/.test(String(input.characterId || ''))
      ? input.characterId
      : 'chie'

    let response
    try {
      response = await signedPost('CVSync2AsyncSubmitTask', {
        req_key: ability.reqKey,
        image_urls: Array.from({ length: ability.imageCount }, () => imageUrl),
        prompt,
        seed: -1,
        frames,
      }, {
        ...(await credentials()),
        ...(fetchImpl ? { fetchImpl } : {}),
      })
    } catch (error) {
      if (error instanceof VolcSignatureError) {
        throw new JimengVideoError(error.code, error.message, { status: 503 })
      }
      throw error
    }

    const { ok, status, body } = await parseVisualJson(response)
    if (!ok || body.code !== 10000 || !body.data?.task_id) {
      const upstreamCode = body.code
      throw new JimengVideoError(
        upstreamCode === 50429 || upstreamCode === 50430 ? 'JIMENG_RATE_LIMITED' : 'JIMENG_SUBMIT_FAILED',
        body.message || '首尾帧视频任务提交失败',
        { code: upstreamCode, requestId: body.request_id, status: upstreamCode === 50429 || upstreamCode === 50430 ? 429 : 502 },
      )
    }

    const task = {
      provider: 'jimeng',
      taskId: body.data.task_id,
      requestId: body.request_id,
      reqKey: ability.reqKey,
      characterId,
      dialogue,
      prompt,
      emotion,
      frames,
      ability: abilityKey,
      status: 'in_queue',
      createdAt: new Date().toISOString(),
    }
    tasks.set(task.taskId, task)
    return task
  }

  async function queryVideo(input = {}) {
    const taskId = String(input.taskId ?? '')
    if (!/^\d{8,32}$/.test(taskId)) throw new JimengVideoError('INVALID_TASK_ID', '无效的视频任务 ID', { status: 400 })
    const known = tasks.get(taskId)
    const reqKey = known?.reqKey || (input.reqKey && Object.values(JIMENG_ABILITIES).some((item) => item.reqKey === input.reqKey)
      ? input.reqKey
      : JIMENG_ABILITIES.v30_1080.reqKey)

    let response
    try {
      response = await signedPost('CVSync2AsyncGetResult', {
        req_key: reqKey,
        task_id: taskId,
      }, {
        ...(await credentials()),
        ...(fetchImpl ? { fetchImpl } : {}),
      })
    } catch (error) {
      if (error instanceof VolcSignatureError) {
        throw new JimengVideoError(error.code, error.message, { status: 503 })
      }
      throw error
    }

    const { ok, body } = await parseVisualJson(response)
    if (!ok || body.code !== 10000) {
      const upstreamCode = body.code
      throw new JimengVideoError(
        upstreamCode === 50429 || upstreamCode === 50430 ? 'JIMENG_RATE_LIMITED' : 'JIMENG_QUERY_FAILED',
        body.message || '查询视频任务失败',
        { code: upstreamCode, requestId: body.request_id, status: upstreamCode === 50429 || upstreamCode === 50430 ? 429 : 502 },
      )
    }

    const status = body.data?.status || 'unknown'
    if (status === 'not_found' || status === 'expired') {
      tasks.delete(taskId)
      return { status, requestId: body.request_id, taskId }
    }
    if (status !== 'done' || !body.data?.video_url) {
      return { status, requestId: body.request_id, taskId }
    }
    return {
      status: 'done',
      requestId: body.request_id,
      taskId,
      videoUrl: body.data.video_url,
      aigcMetaTagged: Boolean(body.data.aigc_meta_tagged),
    }
  }

  return {
    id: 'jimeng',
    capability: 'avatar-media',
    label: '即梦 3.0 对话视频（火山视觉）',
    available: () => true,
    capabilities: () => ({
      modes: ['video-gen'],
      abilities: Object.keys(JIMENG_ABILITIES),
      maxDialogueChars: 500,
      maxMotionChars: 300,
    }),
    submitVideo,
    queryVideo,
  }
}
