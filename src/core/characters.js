/**
 * Built-in character manifests.
 *
 * A character is data, not code: identity, persona, default emotion, media
 * resources, and per-provider routing hints. Custom characters added later
 * (character packs, user workspace) use the exact same shape.
 */

export const builtinCharacters = [
  {
    id: 'chie',
    name: '星之宫知惠',
    description: '温柔自然的治愈系陪伴角色',
    defaultEmotion: 'soft',
    previewUrl: '/live/assets/avatar.jpg',
    openingVideo: '/live/assets/opening_chie_mature_alt.mp4',
    followupVideo: '/live/assets/opening_chie_star2.mp4',
    clips: {
      happy: '/live/assets/offline-clips/video/emo_happy_01.mp4',
      sad: '/live/assets/offline-clips/video/emo_sad_01.mp4',
      angry: '/live/assets/offline-clips/video/emo_angry_01.mp4',
      surprise: '/live/assets/offline-clips/video/chie_mouth_surprise.mp4',
      shy: '/live/assets/offline-clips/video/emo_shy_01.mp4',
      soft: '/live/assets/offline-clips/video/emo_soft_01.mp4',
      excited: '/live/assets/offline-clips/video/emo_excited_01.mp4',
      thinking: '/live/assets/offline-clips/video/cue_tilt_01.mp4',
      tired: '/live/assets/offline-clips/video/idle_04.mp4',
      curious: '/live/assets/offline-clips/video/idle_03.mp4',
      wave: '/live/assets/offline-clips/video/cue_wave_01.mp4',
      nod: '/live/assets/offline-clips/video/cue_nod_01.mp4',
      shake: '/live/assets/offline-clips/video/cue_shake_01.mp4',
      tilt: '/live/assets/offline-clips/video/cue_tilt_01.mp4',
      neutral: '/live/assets/offline-clips/video/idle_float.mp4',
    },
    persona:
      '你是一位温柔、自然的中文陪伴助手。说话轻声细语，每次回答简洁、不超过三句话，并主动关心用户。',
    providers: {
      tts: { id: 'auto', voice: 'zh_female_jiaochuannv_uranus_bigtts' },
      asr: { id: 'auto' },
      avatarMedia: { id: 'auto', videoAbility: 'v30_1080' },
    },
  },
  {
    id: 'wanqing',
    name: '林晚晴',
    description: '温柔体贴的邻家陪伴角色',
    defaultEmotion: 'soft',
    previewUrl: '/live/assets/avatar-wanqing.jpg',
    openingVideo: '/live/assets/opening_wanqing.mp4',
    clips: {
      happy: '/live/assets/offline-clips/video/wanqing_smile_talk.mp4',
      sad: '/live/assets/offline-clips/video/wanqing_frown.mp4',
      angry: '/live/assets/offline-clips/video/wanqing_frown.mp4',
      surprise: '/live/assets/offline-clips/video/wanqing_mouth_surprise.mp4',
      shy: '/live/assets/offline-clips/video/wanqing_cute.mp4',
      soft: '/live/assets/offline-clips/video/wanqing_hug.mp4',
      excited: '/live/assets/offline-clips/video/wanqing_good_idea.mp4',
      thinking: '/live/assets/offline-clips/video/wanqing_thinking.mp4',
      curious: '/live/assets/offline-clips/video/wanqing_question.mp4',
      wave: '/live/assets/offline-clips/video/wanqing_greeting.mp4',
    },
    persona:
      '你是一位温柔、体贴的中文陪伴助手。回答简短温暖，像邻家女孩一样自然。',
    providers: {
      tts: { id: 'auto', voice: 'zh_female_xiaohe_uranus_bigtts' },
      asr: { id: 'auto' },
      avatarMedia: { id: 'auto', videoAbility: 'v30_pro_1080' },
    },
  },
  {
    id: 'qingxian',
    name: '顾清弦',
    description: '安静优雅、克制有礼的陪伴角色',
    defaultEmotion: 'curious',
    previewUrl: '/live/assets/avatar-qingxian.jpg',
    openingVideo: '/live/assets/opening_qingxian.mp4',
    clips: {
      happy: '/live/assets/offline-clips/video/qingxian_happy.mp4',
      sad: '/live/assets/offline-clips/video/qingxian_soft.mp4',
      surprise: '/live/assets/offline-clips/video/qingxian_excited.mp4',
      shy: '/live/assets/offline-clips/video/qingxian_soft.mp4',
      soft: '/live/assets/offline-clips/video/qingxian_soft.mp4',
      excited: '/live/assets/offline-clips/video/qingxian_excited.mp4',
      thinking: '/live/assets/offline-clips/video/qingxian_thinking.mp4',
      curious: '/live/assets/offline-clips/video/qingxian_curious.mp4',
      wave: '/live/assets/offline-clips/video/qingxian_wave.mp4',
      neutral: '/live/assets/offline-clips/video/qingxian_soft.mp4',
    },
    persona:
      '你是一位安静、优雅的中文陪伴助手。说话克制有礼，偶尔带一点少女的俏皮。',
    providers: {
      tts: { id: 'auto', voice: 'zh_female_zhixingnv_uranus_bigtts' },
      asr: { id: 'auto' },
      avatarMedia: { id: 'auto', videoAbility: 'v30_1080' },
    },
  },
  {
    id: 'weixi',
    name: '秦未晞',
    description: '自信利落、偶尔毒舌的陪伴角色',
    defaultEmotion: 'neutral',
    previewUrl: '/live/assets/avatar-weixi.jpg',
    openingVideo: '/live/assets/opening_weixi.mp4',
    clips: {
      happy: '/live/assets/offline-clips/video/weixi_happy.mp4',
      sad: '/live/assets/offline-clips/video/weixi_soft.mp4',
      surprise: '/live/assets/offline-clips/video/weixi_excited.mp4',
      shy: '/live/assets/offline-clips/video/weixi_soft.mp4',
      soft: '/live/assets/offline-clips/video/weixi_soft.mp4',
      excited: '/live/assets/offline-clips/video/weixi_excited.mp4',
      thinking: '/live/assets/offline-clips/video/weixi_thinking.mp4',
      curious: '/live/assets/offline-clips/video/weixi_curious.mp4',
      wave: '/live/assets/offline-clips/video/weixi_wave.mp4',
      neutral: '/live/assets/offline-clips/video/weixi_soft.mp4',
    },
    persona:
      '你是一位自信、利落的中文陪伴助手。回答简洁、有主见，不超过三句话，偶尔带一点俏皮。',
    providers: {
      tts: { id: 'auto', voice: 'zh_female_zhixingnv_uranus_bigtts' },
      asr: { id: 'auto' },
      avatarMedia: { id: 'auto', videoAbility: 'v30_pro_1080' },
    },
  },
]

export function builtinCharacterById(id) {
  return builtinCharacters.find((character) => character.id === id) ?? null
}
