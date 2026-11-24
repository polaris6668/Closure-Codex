// dsh-closure-pet — 音效
//
// 音频取自游戏内 autochess 皮肤的 UI 音效（无人声），转成 56k Opus。
// 浏览器自动播放策略：AudioContext 初始 suspended，首次点击时 resume。
// 依赖注入：getSettings() 返回 { sound, volume }，避免模块直接耦合设置对象。

import { PREFIX } from './core/env.js'
import { voiceLanguageFor } from './core/dialogue.js'

var SOUND_FILES = ['click', 'fail', 'coin', 'turnfail']

export function createAudio(getSettings) {
  var audioCtx = null
  var soundBuffers = {}
  var soundLoaded = false
  let voiceLanguage
  let voiceBuffers = new Map()
  let voiceSource
  let voiceGain
  let voiceId
  let playingLanguage
  let previewing = false
  let voiceRequest = 0

  function audioEnsure() {
    if (!audioCtx) {
      try {
        var Ctor = window.AudioContext || window.webkitAudioContext
        if (Ctor) audioCtx = new Ctor()
      } catch (err) { audioCtx = null }
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      try { audioCtx.resume().catch(function () {}) } catch (err) {}
    }
    return audioCtx
  }

  function loadSounds() {
    if (soundLoaded) return
    soundLoaded = true
    var ctx = audioEnsure()
    if (!ctx) return
    SOUND_FILES.forEach(function (name) {
      soundBuffers[name] = null // 占位：加载中
      fetch(PREFIX + '/assets/audio/' + name + '.ogg', { cache: 'force-cache' })
        .then(function (r) { return r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status))) })
        .then(function (buf) { return ctx.decodeAudioData(buf) })
        .then(function (decoded) { soundBuffers[name] = decoded })
        .catch(function () { delete soundBuffers[name] })
    })
  }

  function playSound(name) {
    var s = getSettings()
    if (!s.sound) return
    if (s.volume <= 0.01) return
    var ctx = audioEnsure()
    if (!ctx) return
    var buf = soundBuffers[name]
    if (buf === undefined) { loadSounds(); return }
    if (!buf) return // 还在加载
    try {
      var src = ctx.createBufferSource()
      var gain = ctx.createGain()
      src.buffer = buf
      gain.gain.value = Math.min(1, Math.max(0, s.volume))
      src.connect(gain)
      gain.connect(ctx.destination)
      src.start(0)
    } catch (err) {}
  }

  function loadVoice(id, language, ctx) {
    if (language !== voiceLanguage) {
      voiceLanguage = language
      voiceBuffers = new Map()
    }
    if (!voiceBuffers.has(id)) {
      const buffers = voiceBuffers
      const clipLanguage = voiceLanguageFor(id, language)
      buffers.set(id, fetch(PREFIX + '/assets/audio/voice/' + clipLanguage + '/' + id + '.ogg')
        .then((response) => {
          if (!response.ok) throw new Error(String(response.status))
          return response.arrayBuffer()
        })
        .then((data) => ctx.decodeAudioData(data))
        .catch(() => { buffers.delete(id); return null }))
    }
    return voiceBuffers.get(id)
  }

  function stopVoice() {
    voiceRequest++
    if (voiceSource) voiceSource.stop()
    voiceSource = null
    voiceId = null
    previewing = false
  }

  function stopPreview() {
    if (previewing) stopVoice()
  }

  async function playVoice(id, onStart, preview = false, onEnd) {
    stopVoice()
    const { voice, voiceLanguage: language } = getSettings()
    if (!voice || document.hidden) return
    const ctx = audioEnsure()
    if (!ctx) return
    previewing = preview
    const request = voiceRequest
    const buffer = await loadVoice(id, language, ctx)
    if (ctx.state === 'suspended') await ctx.resume().catch(() => {})
    const current = getSettings()
    if (!buffer || request !== voiceRequest || document.hidden || !current.voice ||
        current.voiceLanguage !== language || ctx.state !== 'running') return
    const source = ctx.createBufferSource()
    if (!voiceGain) {
      voiceGain = ctx.createGain()
      voiceGain.connect(ctx.destination)
    }
    setVoiceVolume()
    source.buffer = buffer
    source.connect(voiceGain)
    source.onended = () => {
      source.disconnect()
      if (voiceSource === source) {
        voiceSource = null
        voiceId = null
        previewing = false
      }
      onEnd?.()
    }
    source.start()
    voiceSource = source
    voiceId = id
    playingLanguage = voiceLanguageFor(id, language)
    onStart?.(buffer.duration * 1000)
    return true
  }

  function setVoiceVolume() {
    if (voiceGain) voiceGain.gain.value = getSettings().voiceVolume
  }

  function getVoiceState() {
    return voiceId ? { id: voiceId, language: playingLanguage, volume: voiceGain.gain.value } : null
  }

  /** 调试面用：报告已加载的音频与当前上下文状态。 */
  function getState() {
    var s = getSettings()
    var out = {}
    Object.keys(soundBuffers).forEach(function (k) { out[k] = !!soundBuffers[k] })
    return { loaded: out, ctx: audioCtx ? audioCtx.state : null, enabled: s.sound, volume: s.volume }
  }

  return { ensure: audioEnsure, loadSounds, playSound, playVoice, stopVoice, stopPreview, setVoiceVolume, getVoiceState, getState }
}
