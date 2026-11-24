// dsh-closure-pet — 用户设置
//
// settings 是可变对象：面板、宿主配置、默认值都直接改它的字段。
// 持久化有两份：localStorage（浏览器侧，立即生效）+ PUT /config（宿主落盘到 $DSH_HOME/.dshcl.json）。

import { PREFIX, SETTINGS_KEY } from './env.js'
import { SETTINGS_DEFAULTS, normalizeSettings } from '../shared/protocol.js'

export const settings = {
  ...SETTINGS_DEFAULTS,
  ...(new URLSearchParams(globalThis.location?.search).get('macOS') === '1' && { voiceLanguage: 'ja' }),
}

export function loadSettings() {
  try {
    var raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return
    var v = JSON.parse(raw)
    if (!v || typeof v !== 'object') return
    const normalized = normalizeSettings(v, settings)
    // Older profiles used a shared volume for effects and voice.
    if (!Object.hasOwn(v, 'voiceVolume')) normalized.voiceVolume = normalized.volume
    Object.assign(settings, normalized)
  } catch (err) {}
}

var saveTimer = 0

export function saveSettings(immediate) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({
      mirror: settings.mirror, size: settings.size, fps: settings.fps,
      bubble: settings.bubble, opacity: settings.opacity,
      bubbleFontSize: settings.bubbleFontSize, bubbleScale: settings.bubbleScale,
      sound: settings.sound, volume: settings.volume,
      voice: settings.voice, voiceLanguage: settings.voiceLanguage, voiceVolume: settings.voiceVolume,
      voiceQueueMode: settings.voiceQueueMode, voiceQueues: settings.voiceQueues,
      standaloneVoiceQueueMode: settings.standaloneVoiceQueueMode, standaloneVoiceQueue: settings.standaloneVoiceQueue,
      toolFailureNotice: settings.toolFailureNotice, quotaReminderMinutes: settings.quotaReminderMinutes,
    }))
  } catch (err) {}
  // 同时写回宿主（$DSH_HOME/.dshcl.json），换浏览器/清缓存也能恢复
  clearTimeout(saveTimer)
  var push = function () {
    try {
      fetch(PREFIX + '/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: settings }),
      }).catch(function () {})
    } catch (err) {}
  }
  if (immediate) push()
  else saveTimer = setTimeout(push, 400)
}

// 启动时合并浏览器里的旧设置（宿主配置在 boot 后由 loadHostConfig 合并）
loadSettings()
