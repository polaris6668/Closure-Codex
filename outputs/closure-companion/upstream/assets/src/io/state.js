// dsh-closure-pet — 宿主状态轮询与事件分发
//
// 每秒拉 /dsh-closure/state；用计数器（而非布尔）识别事件，轮询丢帧也不会漏。
// applyState 负责把状态映射成：动画层、气泡反馈、音效、开屏时序。
// 依赖注入：layers / playOverlay / syncAnimation / showBubble / refreshBubble / playSound /
// scheduleStartup / settings / saveSettings / layout / repositionForAnchor / resolveFlip /
// applyOpacity / isBubbleShown。

import { PREFIX, SIZE_MIN, SIZE_MAX } from '../core/env.js'
import { HAPPY_CHANCE } from '../anim/library.js'
import { normalizeSettings } from '../shared/protocol.js'

const WORKING_VOICE_DELAY = 15_000
const IDLE_VOICE_DELAY = 5 * 60_000

export const LOW_QUOTA_NOTICE = '博士，额度快见底了。手头还有多少活？'
const UNKNOWN_ERROR_NOTICE = '奇怪，光看这条报错还不知道是哪儿出了问题。'

export function createState(deps) {
  var layers = deps.layers
  var playOverlay = deps.playOverlay
  var syncAnimation = deps.syncAnimation
  var showBubble = deps.showBubble
  var refreshBubble = deps.refreshBubble
  var playSound = deps.playSound
  var scheduleStartup = deps.scheduleStartup
  var settings = deps.settings
  var saveSettings = deps.saveSettings
  var layout = deps.layout
  var repositionForAnchor = deps.repositionForAnchor
  var resolveFlip = deps.resolveFlip
  var applyOpacity = deps.applyOpacity
  var isBubbleShown = deps.isBubbleShown

  // ————————————————————— P4：宿主状态轮询 —————————————————————
  // 每秒拉 /dsh-closure/state；用计数器增量识别事件（轮询丢帧也不会漏）。
  var pollTimer = 0
  var pollTimerMs = 0
  var lastState = null
  var toolPlayTimes = []
  var TOOL_MIN_GAP = 1200      // 同类事件最小间隔
  var TOOL_WINDOW = 10000      // 限流窗口
  var TOOL_WINDOW_MAX = 3      // 窗口内最多播几次
  var lowBalance = false
  var lowQuotaWindows = new Set()
  let lastQuotaReminder = Date.now()
  let workSince = null
  let idleSince = null
  let workingSpoken = false
  let idleSpoken = false
  let lastMacTurn = 0
  let lastMacEvent = 0
  let playingMacTurn = false
  let macStartupDue = null
  let macToolNoticeAt = 0
  const macTurnQueue = []

  async function playMacTurns() {
    if (playingMacTurn || document.hidden) return
    playingMacTurn = true
    try {
      while (macTurnQueue.length && !document.hidden) {
        const { kind, scene, text, animation } = macTurnQueue.shift()
        if (kind === 'completed') {
          playOverlay('Happy')
          await deps.playQueuedDialogue('completion', settings.voiceQueueMode === 'personal' &&
            !settings.voiceQueues.completion.length ? '博士，这轮任务完成了。' : '')
        } else if (scene) {
          if ((scene === 'working' && !lastState?.work?.active) || (scene === 'idle' && lastState?.work?.active)) continue
          if (animation) playOverlay(animation)
          await deps.playQueuedDialogue(scene, text)
        } else {
          const duration = 3200
          showBubble(text || (kind === 'error' ? '博士，这轮任务出错了。' : '博士，这轮任务停下了。'), duration)
          await new Promise((resolve) => setTimeout(resolve, duration))
        }
        syncAnimation(false)
      }
    } finally {
      playingMacTurn = false
    }
  }

  function applyMacState(s) {
    const now = Date.now()
    const active = Boolean(s.work?.active)
    const lowWindows = (s.closureCompanion?.quota || []).filter(({ remaining }) => remaining <= 10)
    const newlyLow = lowWindows.some(({ minutes }) => !lowQuotaWindows.has(minutes))
    lowQuotaWindows = new Set(lowWindows.map(({ minutes }) => minutes))
    layers.base = lowWindows.length ? 'Sad_Idle' : 'Idle'
    layers.work = active ? 'Special_B' : null
    if (macStartupDue === null) macStartupDue = now + 5000
    if (now >= macStartupDue && s.closureCompanion?.following) {
      macStartupDue = Infinity
      if (!active) macTurnQueue.push({ scene: 'startup', animation: 'Special_A' })
    }
    for (const event of s.desktopEvents || []) {
      if (event.seq <= lastMacEvent) continue
      lastMacEvent = event.seq
      if (event.scene === 'toolFailure') {
        if (!settings.toolFailureNotice || now - macToolNoticeAt < TOOL_MIN_GAP) continue
        macToolNoticeAt = now
        const title = event.name ? '博士，' + event.name + ' 报错了。' : '博士，刚才那个工具没跑起来。'
        macTurnQueue.push({ scene: event.scene, animation: 'Sad_Begin', text: title + '\n' + (event.reason || UNKNOWN_ERROR_NOTICE) })
      } else if (event.scene !== 'start' || active) {
        macTurnQueue.push({ scene: event.scene })
      }
    }
    for (const turn of s.turnEnds || []) {
      if (turn.seq <= lastMacTurn) continue
      macTurnQueue.push(turn)
      lastMacTurn = turn.seq
    }
    if (active) {
      workSince ??= now
      idleSince = null
      if (!workingSpoken && now - workSince >= WORKING_VOICE_DELAY) {
        workingSpoken = true
        macTurnQueue.push({ scene: 'working' })
      }
    } else {
      workSince = null
      workingSpoken = false
      if (idleSince === null) {
        idleSince = now
        idleSpoken = false
      }
      if (s.closureCompanion?.following && !idleSpoken && now - idleSince >= IDLE_VOICE_DELAY) {
        idleSpoken = true
        macTurnQueue.push({ scene: 'idle' })
      }
    }
    if (newlyLow) macTurnQueue.push({ text: LOW_QUOTA_NOTICE })
    syncAnimation(false)
    if (macTurnQueue.length) playMacTurns().catch(console.error)
    else if (!playingMacTurn && !isBubbleShown() && settings.quotaReminderMinutes > 0 && !document.hidden &&
      now - lastQuotaReminder >= settings.quotaReminderMinutes * 60000 && deps.showQuota?.()) lastQuotaReminder = now
  }

  function react(name, message, sound, duration, voiceScene) {
    return playOverlay(name, undefined, function () {
      if (message && !(voiceScene && deps.showDialogue(voiceScene, message, duration))) {
        showBubble(message, duration)
      }
      if (sound) playSound(sound)
    })
  }

  function toolOverlay(name, message, sound, duration, voiceScene) {
    var now = Date.now()
    toolPlayTimes = toolPlayTimes.filter(function (t) { return now - t < TOOL_WINDOW })
    var last = toolPlayTimes.length ? toolPlayTimes[toolPlayTimes.length - 1] : 0
    if (now - last < TOOL_MIN_GAP) return false
    if (toolPlayTimes.length >= TOOL_WINDOW_MAX) return false
    toolPlayTimes.push(now)
    react(name, message, sound, duration, voiceScene)
    return true
  }

  function applyState(s) {
    if (!s || typeof s !== 'object') return
    var prev = lastState
    lastState = s
    if (deps.macOS) {
      applyMacState(s)
      return
    }
    var first = !prev
    if (prev?.closureCompanion?.source !== s.closureCompanion?.source) lowQuotaWindows.clear()

    var mode = s.work && s.work.mode
    layers.work = mode === 'outputting' ? 'Talk' : (mode === 'thinking' ? 'Special_B' : null)
    const now = Date.now()
    const newTurn = (s.turnStartSeq ?? 0) > (prev?.turnStartSeq ?? 0)
    const active = s.work?.active ?? Boolean(layers.work)
    const quotaIsLow = s.closureCompanion?.quota.some(({ remaining }) => remaining <= 10)
    const quotaChanged = s.closureCompanion && quotaIsLow !== (lowQuotaWindows.size > 0)
    if (s.closureCompanion) {
      if (active) {
        if (workSince === null || newTurn) {
          workSince = now
          workingSpoken = false
        }
        idleSince = null
      } else {
        workSince = null
        if (idleSince === null || newTurn || s.turnEnd?.seq > (prev?.turnEnd?.seq ?? 0)) {
          idleSince = now
          idleSpoken = false
        }
      }
    }

    if (s.closureCompanion) {
      var quota = s.closureCompanion.quota
      layers.base = quotaIsLow ? 'Sad_Idle' : 'Idle'
      var wasLow = lowQuotaWindows.size > 0
      for (const entry of quota) {
        if (entry.remaining <= 10) lowQuotaWindows.add(entry.minutes)
        else lowQuotaWindows.delete(entry.minutes)
      }
      if (first) {
        scheduleStartup(false, quotaIsLow, true)
      } else if (quotaIsLow && !wasLow) {
        react('Sad_Begin', LOW_QUOTA_NOTICE, 'fail')
      } else if (wasLow && !lowQuotaWindows.size) {
        react('Special_A', '哦，额度回来了。博士，刚才做到哪儿了？', 'coin')
      }
    } else if (first) {
      var low = !!(s.balance && s.balance.low)
      lowBalance = low
      layers.base = low ? 'Sad_Idle' : 'Idle'
      // 启动时序延迟播放：等客户端首屏稳定后再演（默认 10s，
      // localStorage 的 dshcl-startup-delay 可覆盖，方便调试）
      scheduleStartup(s.period === 'peak', low)
    } else if (s.balance && s.balance.ok && Boolean(s.balance.low) !== lowBalance) {
      var low = Boolean(s.balance.low)
      lowBalance = low
      layers.base = low ? 'Sad_Idle' : 'Idle'
      // 变低 → 难过一次；恢复 → 充值成功式（Special_A），不是难过
      // 若同一轮还带 topUpSeq，交给下面的"充值到账"分支报，避免两句话打架
      var sameTickTopUp = s.topUpSeq > ((prev && prev.topUpSeq) || 0)
      if (low || !sameTickTopUp) react(low ? 'Sad_Begin' : 'Special_A',
        low ? '博士！预算快见底了\n该批经费啦！' : '经费到账\n可露希尔继续为你效力~', low ? 'fail' : 'coin')
    }

    if (prev) {
      var prevTurnEnd = (prev.turnEnd && prev.turnEnd.seq) || 0
      var curTurnEnd = (s.turnEnd && s.turnEnd.seq) || 0
      var kind = (s.turnEnd && s.turnEnd.kind) || 'completed'
      var terminalFailure = curTurnEnd > prevTurnEnd && kind !== 'completed'
      var prevErrCount = (prev.errors && prev.errors.count) || 0
      var curErrCount = (s.errors && s.errors.count) || 0
      if (s.tools && prev.tools) {
        // 工具成功：只保留概率性的 Happy 动画，不出气泡、不播音效
        if (s.tools.fail > prev.tools.fail && !terminalFailure && curErrCount <= prevErrCount) {
          if (settings.toolFailureNotice) {
            const name = s.tools.lastFailName
            const title = name ? '博士，' + name + ' 报错了。' : '博士，刚才那个工具没跑起来。'
            toolOverlay('Sad_Begin', title + '\n' + (s.tools.lastFailReason || UNKNOWN_ERROR_NOTICE), 'fail', 4600,
              s.closureCompanion ? 'toolFailure' : undefined)
          }
        } else if (s.tools.fail === prev.tools.fail && s.tools.ok > prev.tools.ok) {
          var successCount = s.tools.ok - prev.tools.ok
          // 一次轮询合并了多次成功时，保留每次工具成功原有的庆祝概率。
          if (Math.random() < 1 - Math.pow(1 - HAPPY_CHANCE, successCount)) toolOverlay('Happy')
        }
      }
      // 模型/轮次级错误：只报反馈内容（气泡此时不显示余额/花费）
      if (curErrCount > prevErrCount && !terminalFailure) {
        react('Sad_Begin', '嗯？怎么在这儿报错了？\n' + (s.errors.message || UNKNOWN_ERROR_NOTICE), 'fail', 4600)
      }
      if (s.topUpSeq > prev.topUpSeq) {
        react('Special_A', '感谢惠顾~\n采购部随时欢迎下次光临！', 'coin')
      }
      // 本轮结束（turn/end）：完成 / 中断 / 出错各给一句反馈
      const toolFailed = settings.toolFailureNotice && s.tools?.fail > prev.tools?.fail
      const canSpeak = !quotaChanged && curErrCount <= prevErrCount && !toolFailed
      const inputScene = s.userInput?.scene
      const inputSpoken = s.closureCompanion && canSpeak && !terminalFailure &&
        (s.userInput?.seq ?? 0) > (prev.userInput?.seq ?? 0) &&
        (inputScene === 'question' || inputScene === 'answer') && deps.showDialogue(inputScene)
      if (curTurnEnd > prevTurnEnd) {
        if (kind === 'completed') {
          if (canSpeak && !inputSpoken) {
            if (s.closureCompanion) deps.showDialogue('completion')
            else if (!layers.overlay) showBubble()
          }
        } else if (kind === 'error') {
          const { reason, errorSeq } = s.turnEnd
          if (!errorSeq || errorSeq > prevErrCount) {
            react('Sad_Begin', '博士，这轮卡在这儿了。\n' + (reason || UNKNOWN_ERROR_NOTICE), 'turnfail', 4600)
          }
        } else {
          react('Sad_Begin', '欸，这轮停了。博士，还接着做吗？', 'turnfail')
        }
      } else if (s.closureCompanion && newTurn && canSpeak && !inputSpoken) {
        deps.showDialogue('start')
      }
      if (s.closureCompanion && canSpeak && !terminalFailure && !inputSpoken) {
        if (workSince !== null && !workingSpoken && now - workSince >= WORKING_VOICE_DELAY) {
          workingSpoken = deps.showDialogue('working')
        } else if (idleSince !== null && !idleSpoken && now - idleSince >= IDLE_VOICE_DELAY) {
          idleSpoken = deps.showDialogue('idle')
        }
      }
      if (s.periodSeq > prev.periodSeq) {
        react(s.period === 'peak' ? 'Sad_Begin' : 'Special_A',
          s.period === 'peak' ? '开始按原价收费了哦博士~' : '可露希尔大减价时间到~\n冲啊博士！')
      }
    }
    // 气泡开着的时候顺带刷新数字（余额 / 倒计时）
    if (isBubbleShown()) refreshBubble()
    else if (settings.quotaReminderMinutes > 0 && deps.showQuota && s.closureCompanion?.source && !document.hidden &&
        Date.now() - lastQuotaReminder >= settings.quotaReminderMinutes * 60000 && deps.showQuota()) {
      lastQuotaReminder = Date.now()
    }
    syncAnimation(false)
  }

  function pollState() {
    fetch(PREFIX + '/state', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null })
      .then(function (s) { try { applyState(s) } catch (err) {} })
      .catch(function () { /* 路由不可用就纯待机，不报错 */ })
  }

  function startPolling() {
    pollState()
    setPollInterval(1000)
  }

  // 前台 1s 轮询；后台降到 5s（省电，且后台本来就看不到）
  function setPollInterval(ms) {
    if (pollTimer && pollTimerMs === ms) return
    if (pollTimer) clearInterval(pollTimer)
    pollTimerMs = ms
    pollTimer = setInterval(pollState, ms)
  }

  // 宿主侧持久化设置（$DSH_HOME/.dshcl.json）优先于 localStorage
  function loadHostConfig() {
    fetch(PREFIX + '/config', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null })
      .then(function (cfg) {
        var s = cfg && cfg.settings
        if (!s) return
        if (s.mirror === 'auto' || s.mirror === 'always' || s.mirror === 'never') settings.mirror = s.mirror
        if (isFinite(Number(s.size))) settings.size = Math.min(SIZE_MAX, Math.max(SIZE_MIN, Number(s.size)))
        if (typeof s.bubble === 'boolean') settings.bubble = s.bubble
        if (isFinite(Number(s.opacity))) settings.opacity = Math.min(1, Math.max(0.3, Number(s.opacity)))
        if (typeof s.sound === 'boolean') settings.sound = s.sound
        if (isFinite(Number(s.volume))) settings.volume = Math.min(1, Math.max(0, Number(s.volume)))
        const { fps, bubbleFontSize, bubbleScale, voiceQueueMode, voiceQueues } = normalizeSettings(s, settings)
        Object.assign(settings, { fps, bubbleFontSize, bubbleScale, voiceQueueMode, voiceQueues })
        layout()
        repositionForAnchor()
        resolveFlip()
        applyOpacity()
        if (isBubbleShown()) refreshBubble()
        saveSettings(true)
      })
      .catch(function () { /* 宿主不可用就沿用 localStorage */ })
  }

  function dispose() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = 0 }
    pollTimerMs = 0
  }

  return {
    applyState: applyState,
    pollState: pollState,
    startPolling: startPolling,
    setPollInterval: setPollInterval,
    loadHostConfig: loadHostConfig,
    getState: function () { return lastState },
    isPlayingTaskVoice: () => playingMacTurn,
    dispose: dispose,
  }
}
