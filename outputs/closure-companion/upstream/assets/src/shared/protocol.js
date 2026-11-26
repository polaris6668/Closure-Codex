// dsh-closure-pet — 前后端共享协议
//
// 宿主（lib/）与浏览器（assets/src/）都 import 这个文件：
//   · URL 前缀与 /state、/config 路径
//   · 协议版本（/state、/config 响应里带 schemaVersion/version）
//   · 设置默认值与归一化规则（宿主落盘、浏览器 localStorage 共用同一套 clamp）
//
// 该文件必须保持「纯数据 + 纯函数」：浏览器会通过 /dsh-closure/src/shared/protocol.js 加载它。

import { DEFAULT_VOICE_QUEUES, dialogue, VOICE_SCENES } from '../core/dialogue.js'

export const SCHEMA_VERSION = 1

export const URL_PREFIX = '/dsh-closure'
export const STATE_PATH = URL_PREFIX + '/state'
export const CONFIG_PATH = URL_PREFIX + '/config'

export const SIZE_MIN = 0.6
export const SIZE_MAX = 2.0
export const FPS_MIN = 30
export const FPS_MAX = 60
export const BUBBLE_FONT_MIN = 12
export const BUBBLE_FONT_MAX = 36
export const BUBBLE_SCALE_MIN = 0.6
export const BUBBLE_SCALE_MAX = 1.6
export const OPACITY_MIN = 0.3
export const VOICE_LANGUAGES = Object.freeze({ zh: '中文（普通话）', ja: '日语', en: '英语', ko: '韩语' })
export const STANDALONE_DEFAULT_VOICES = Object.freeze(Object.keys(dialogue))

export const SETTINGS_DEFAULTS = Object.freeze({
  mirror: 'auto',
  size: 1,
  fps: FPS_MAX,
  bubble: true,
  bubbleFontSize: 24,
  bubbleScale: 1,
  opacity: 1,
  sound: true,
  volume: 0.7,
  voice: true,
  voiceLanguage: 'zh',
  voiceVolume: 0.7,
  voiceQueueMode: 'default',
  voiceQueues: Object.freeze(Object.fromEntries(Object.keys(VOICE_SCENES).map((scene) => [scene, Object.freeze([])]))),
  standaloneVoiceQueueMode: 'default',
  standaloneVoiceQueue: Object.freeze([]),
  toolFailureNotice: true,
  quotaReminderMinutes: 0,
})

export function getVoiceQueues(settings) {
  return settings.voiceQueueMode === 'personal' ? settings.voiceQueues : DEFAULT_VOICE_QUEUES
}

export function getStandaloneVoiceQueue(settings) {
  return settings.standaloneVoiceQueueMode === 'personal' ? settings.standaloneVoiceQueue : STANDALONE_DEFAULT_VOICES
}

function normalizeVoiceIds(ids) {
  return [...new Set(ids.filter((id) => typeof id === 'string' && Object.hasOwn(dialogue, id)))]
}

/**
 * 把外部传进来的设置补丁归一化到合法范围；非法字段保持 base 的值。
 * 不修改入参，返回新对象。
 */
export function normalizeSettings(raw, base) {
  const out = { ...(base || SETTINGS_DEFAULTS) }
  if (!raw || typeof raw !== 'object') return out
  if (raw.mirror === 'auto' || raw.mirror === 'always' || raw.mirror === 'never') out.mirror = raw.mirror
  const size = Number(raw.size)
  if (Number.isFinite(size)) out.size = Math.min(SIZE_MAX, Math.max(SIZE_MIN, size))
  if (Number.isFinite(raw.fps)) out.fps = Math.min(FPS_MAX, Math.max(FPS_MIN, Math.round(raw.fps)))
  if (typeof raw.bubble === 'boolean') out.bubble = raw.bubble
  if (Number.isFinite(raw.bubbleFontSize)) out.bubbleFontSize = Math.min(BUBBLE_FONT_MAX, Math.max(BUBBLE_FONT_MIN, Math.round(raw.bubbleFontSize)))
  if (Number.isFinite(raw.bubbleScale)) out.bubbleScale = Math.round(Math.min(BUBBLE_SCALE_MAX, Math.max(BUBBLE_SCALE_MIN, raw.bubbleScale)) * 20) / 20
  const opacity = Number(raw.opacity)
  if (Number.isFinite(opacity)) out.opacity = Math.min(1, Math.max(OPACITY_MIN, opacity))
  if (typeof raw.sound === 'boolean') out.sound = raw.sound
  if (typeof raw.voice === 'boolean') out.voice = raw.voice
  if (typeof raw.voiceLanguage === 'string' && Object.hasOwn(VOICE_LANGUAGES, raw.voiceLanguage)) out.voiceLanguage = raw.voiceLanguage
  const volume = Number(raw.volume)
  if (Number.isFinite(volume)) out.volume = Math.min(1, Math.max(0, volume))
  if (Number.isFinite(raw.voiceVolume)) out.voiceVolume = Math.min(1, Math.max(0, raw.voiceVolume))
  if (raw.voiceQueueMode === 'default' || raw.voiceQueueMode === 'personal') out.voiceQueueMode = raw.voiceQueueMode
  if (raw.standaloneVoiceQueueMode === 'default' || raw.standaloneVoiceQueueMode === 'personal') {
    out.standaloneVoiceQueueMode = raw.standaloneVoiceQueueMode
  }
  if (Array.isArray(raw.standaloneVoiceQueue)) out.standaloneVoiceQueue = normalizeVoiceIds(raw.standaloneVoiceQueue)
  if (raw.voiceQueues && typeof raw.voiceQueues === 'object') {
    out.voiceQueues = Object.fromEntries(Object.keys(VOICE_SCENES).map((scene) => {
      const ids = raw.voiceQueues[scene]
      return [scene, Array.isArray(ids)
        ? normalizeVoiceIds(ids)
        : out.voiceQueues[scene]]
    }))
  }
  if (typeof raw.toolFailureNotice === 'boolean') out.toolFailureNotice = raw.toolFailureNotice
  // Older saved reminder intervals migrate to manual middle-button lookup.
  out.quotaReminderMinutes = 0
  return out
}
