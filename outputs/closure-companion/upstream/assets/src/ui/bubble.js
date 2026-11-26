// dsh-closure-pet — 像素气泡（工厂）
//
// 结构：一个 fixed 容器里放「SVG 背景（像素边框 + 硬阴影）+ 文本层」，
// 文本用 Ark Pixel 12px 像素字体；整体 pointer-events:none，不挡下面 UI。
// 依赖注入：getState() 读 /state、pet、size()、settings。

import { PREFIX } from '../core/env.js'

import { dialogue } from '../core/dialogue.js'
import { BUBBLE_FONT_MIN, normalizeSettings, getStandaloneVoiceQueue, getVoiceQueues } from '../shared/protocol.js'
import { createVoiceRotation } from '../core/voice-rotation.js'

export function quotaLines(state) {
  const companion = state?.closureCompanion
  if (Array.isArray(companion?.accounts)) {
    const lines = companion.accounts.filter(account => account.connected === true).flatMap(account => {
      const prefix = account.name || account.host
      if (account.host === 'workbuddy') {
        if (account.credits) return [`WorkBuddy 积分${account.credits.unlimited ? '不限量' : '还剩 ' + account.credits.balance}`]
      } else if (account.host === 'dsh' && account.accountStatus === 'ready') {
        const walletLine = (wallet, bonus) => `DSH ${bonus ? '赠送余额' : '官方余额'} ${Number(wallet.balance).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 6 })} ${wallet.currency}`
        const result = [...(account.wallets || []).map(v => walletLine(v, false)), ...(account.bonusWallets || []).map(v => walletLine(v, true))]
        return result.length ? result : ['DSH 官方余额：暂无钱包']
      } else if (account.host === 'codex') {
        const values = quotaLines({ closureCompanion: { ...account, tokenUsage: null, accounts: undefined } })
        return values.length ? values.map(line => prefix + ' ' + line) : ['Codex：账户余额暂不可用']
      }
      const message = { 'signed-out': '未登录官方账号', unavailable: '官方余额暂不可用', disconnected: '等待连接', checking: '正在查询余额' }[account.accountStatus] || '等待官方余额'
      return [`${prefix}：${message}`]
    })
    if (companion.showTokenUsage) addTokenUsage(lines, companion.tokenUsage)
    return lines
  }
  const lines = []
  if (companion?.source === 'thirdParty') {
    const balance = companion.balance
    if (balance) lines.push([`账户余额 ${balance.remaining.toFixed(2)}`, balance.unit].filter(Boolean).join(' '))
  } else {
    for (const { minutes, remaining } of companion?.quota || []) {
      const window = minutes % 1440 === 0 ? minutes / 1440 + ' 天'
        : minutes % 60 === 0 ? minutes / 60 + ' 小时' : minutes + ' 分钟'
      lines.push(`${window}额度还剩 ${Math.round(remaining * 10) / 10}%`)
    }
    if (companion?.credits) {
      lines.push(`ChatGPT 积分${companion.credits.unlimited ? '不限量' : '还剩 ' + companion.credits.balance}`)
    }
  }
  addTokenUsage(lines, companion?.tokenUsage)
  return lines
}

function addTokenUsage(lines, usage) {
  if (usage) {
    if (usage.turn !== null) lines.push(`这轮用了 ${usage.turn.toLocaleString('zh-CN')} Token`)
    lines.push(`这段对话共用了 ${usage.total.toLocaleString('zh-CN')} Token`)
  }
}

export function createBubble(deps) {
  var getState = deps.getState
  var pet = deps.pet
  var size = deps.size
  var settings = deps.settings
  const audio = deps.audio

  // ————————————————————— 气泡（像素风）—————————————————————
  // 结构：一个 fixed 容器里放「SVG 背景（像素边框 + 硬阴影）+ 文本层」，
  // 文本用 Ark Pixel 12px 像素字体；整体 pointer-events:none，不挡下面 UI。
  var BUBBLE_FONT = '"ArkPixel12", ui-monospace, monospace'
  // 默认 24px（像素字体的 2×）；字号与气泡宽度/留白可独立调整。
  var BUBBLE_SIZE = 24
  var BUBBLE_LINE = 28
  var BUBBLE_PAD = 12
  var BUBBLE_HIDE_MS = 5200
  var BUBBLE_CORNER = 6
  var TAIL_W = 14
  var TAIL_H = 10
  var bubbleEl = null
  var bubbleTextEl = null
  var bubbleTailEl = null
  var bubbleSvg = null
  var bubbleW = 0
  var bubbleH = 0
  var bubbleHideTimer = 0
  var bubbleTickTimer = 0
  var bubbleFollowRaf = 0
  var bubbleFollowUntil = 0
  var bubbleFrameKey = ''

  function stopFollowing() {
    if (bubbleFollowRaf) cancelAnimationFrame(bubbleFollowRaf)
    bubbleFollowRaf = 0
    bubbleFollowUntil = 0
  }

  function hideBubble() {
    stopFollowing()
    bubbleShown = false
    taskDialogueShown = false
    bubbleEventUntil = 0
    clearTimeout(bubbleHideTimer)
    audio.stopVoice()
    if (bubbleEl) {
      try { bubbleEl.getAnimations().forEach(function (a) { a.cancel() }) } catch (err) {}
      bubbleEl.style.opacity = '0'
    }
    if (bubbleTickTimer) { clearInterval(bubbleTickTimer); bubbleTickTimer = 0 }
  }
  var bubbleEventText = ''
  var bubbleEventUntil = 0
  var interactionText = ''
  const nextVoice = createVoiceRotation()
  var bubbleMode = 'info'

  function ensureFont() {
    if (document.getElementById('dsh-closure-pet-font')) return
    var st = document.createElement('style')
    st.id = 'dsh-closure-pet-font'
    st.textContent = '@font-face{font-family:ArkPixel12;src:url("' + PREFIX
      + '/assets/fonts/ark-pixel-12px-zh_hans.woff2") format("woff2");font-display:block}'
    document.head.appendChild(st)
    // 字体是异步加载的：加载完重排一次，避免用回退字体量错宽度
    try {
      document.fonts.load('12px ArkPixel12').then(function () {
        if (bubbleShown) refreshBubble()
      }).catch(function () {})
    } catch (err) {}
  }

  function ensureBubble() {
    if (bubbleEl) return
    bubbleEl = document.createElement('div')
    bubbleEl.id = 'dsh-closure-pet-bubble'
    bubbleEl.style.cssText = [
      'position:fixed', 'left:0', 'top:0', 'z-index:2147481999',
      'pointer-events:none', 'opacity:0',
      'transform-origin:center bottom',
      'filter:none',
    ].join(';')

    bubbleSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    bubbleSvg.setAttribute('shape-rendering', 'crispEdges')
    bubbleSvg.style.cssText = 'position:absolute;left:0;top:0;overflow:visible'
    bubbleEl.appendChild(bubbleSvg)

    bubbleTextEl = document.createElement('div')
    bubbleTextEl.style.cssText = [
      'position:absolute', 'white-space:pre',
      'font-family:' + BUBBLE_FONT,
      'font-size:' + BUBBLE_SIZE + 'px',
      'line-height:' + BUBBLE_LINE + 'px',
      'color:#20232a', 'letter-spacing:0',
      '-webkit-font-smoothing:none', 'font-smooth:never',
      'text-rendering:geometricPrecision',
    ].join(';')
    bubbleEl.appendChild(bubbleTextEl)

    document.body.appendChild(bubbleEl)
  }

  var BUBBLE_MAX_W = 330 // 单行最大宽度（CSS px），按气泡大小与屏幕空间调整

  function measureText(text) {
    var cv = measureText._cv || (measureText._cv = document.createElement('canvas'))
    var ctx = cv.getContext('2d')
    ctx.font = BUBBLE_SIZE + 'px ' + BUBBLE_FONT
    return ctx.measureText(text).width
  }

  /** 按像素宽度折行：优先在空格处断（英文），中文按字符断 */
  function wrapText(text, maxWidth) {
    if (measureText(text) <= maxWidth) return [text]
    var out = []
    var cur = ''
    var lastSpace = -1
    for (var i = 0; i < text.length; i++) {
      var ch = text.charAt(i)
      if (cur && measureText(cur + ch) > maxWidth) {
        if (lastSpace > 0 && measureText(cur.slice(0, lastSpace)) > maxWidth * 0.45) {
          out.push(cur.slice(0, lastSpace))
          cur = cur.slice(lastSpace + 1) + ch
        } else {
          out.push(cur)
          cur = ch
        }
        lastSpace = -1
      } else {
        cur += ch
      }
      if (ch === ' ') lastSpace = cur.length - 1
    }
    if (cur) out.push(cur)
    return out
  }

  // 像素气泡外框：四角切 4px 斜角；尾巴默认朝下（气泡在桌宠上方），
  // 桌面边缘放不下时气泡翻到下方，尾巴改为朝上。
  function bubblePath(w, h, tailX, tailUp) {
    var c = BUBBLE_CORNER
    var t = TAIL_H
    var tw = TAIL_W
    if (!tailUp) {
      var bodyH = h - t
      return [
        'M', c, 0, 'H', w - c, 'V', c, 'H', w, 'V', bodyH - c, 'H', w - c, 'V', bodyH,
        'H', tailX + tw, 'V', h, 'H', tailX, 'V', bodyH,
        'H', c, 'V', bodyH - c, 'H', 0, 'V', c, 'Z',
      ].join(' ')
    }
    var top = t
    return [
      'M', c, top, 'H', tailX, 'V', 0, 'H', tailX + tw, 'V', top,
      'H', w - c, 'V', top + c, 'H', w, 'V', h - c, 'H', w - c, 'V', h,
      'H', c, 'V', h - c, 'H', 0, 'V', top + c, 'H', c, 'Z',
    ].join(' ')
  }

  function renderBubble(lines, tailCenterX, tailUp) {
    ensureFont()
    ensureBubble()
    const appearance = normalizeSettings({ bubbleFontSize: settings.bubbleFontSize, bubbleScale: settings.bubbleScale })
    BUBBLE_PAD = Math.round(12 * appearance.bubbleScale)
    BUBBLE_CORNER = Math.max(4, Math.round(6 * appearance.bubbleScale))
    TAIL_W = Math.max(8, Math.round(14 * appearance.bubbleScale))
    TAIL_H = Math.max(6, Math.round(10 * appearance.bubbleScale))
    BUBBLE_SIZE = appearance.bubbleFontSize
    BUBBLE_MAX_W = Math.max(BUBBLE_FONT_MIN, Math.min(330 * appearance.bubbleScale,
      window.innerWidth - 16 - 6 - 4 - BUBBLE_PAD * 2))
    // 折行规则：
    //   1) 文本里**显式写的 `\n` 优先作为硬换行**（调用方自己控制分行）；
    //   2) 每段再按像素宽度软折行，避免单行把气泡拉得过宽。
    // 之前没有第 1 步：`\n` 被当成普通字符参与测量，整句按宽度硬切，
    // 于是"第二段"开头又被切一次，看起来像多空了一行。
    var wrapped, h
    do {
      BUBBLE_LINE = Math.ceil(BUBBLE_SIZE * 7 / 6)
      wrapped = []
      for (var li = 0; li < lines.length; li++) {
        var segments = String(lines[li]).split(/\r?\n/)
        for (var si = 0; si < segments.length; si++) {
          var parts = wrapText(segments[si], BUBBLE_MAX_W)
          for (var pi = 0; pi < parts.length; pi++) wrapped.push(parts[pi])
        }
      }
      h = wrapped.length * BUBBLE_LINE + BUBBLE_PAD * 2 + TAIL_H
      // Only reduce the displayed font when the requested layout cannot fit on screen.
      if (h + 6 <= window.innerHeight - 16 || BUBBLE_SIZE <= BUBBLE_FONT_MIN) break
      BUBBLE_SIZE--
    } while (true)
    lines = wrapped
    var widest = 0
    for (var i = 0; i < lines.length; i++) widest = Math.max(widest, measureText(lines[i]))
    var w = Math.ceil(widest) + BUBBLE_PAD * 2 + 4
    // 对齐到偶数像素，保证像素边缘清晰
    w = Math.ceil(w / 2) * 2
    h = Math.ceil(h / 2) * 2
    bubbleW = w
    bubbleH = h
    // 容器本身没有内容流（子元素全是绝对定位），必须显式给尺寸
    bubbleEl.style.width = (w + 6) + 'px'
    bubbleEl.style.height = (h + 6) + 'px'

    drawBubbleFrame(tailCenterX, tailUp)
    bubbleTextEl.style.fontSize = BUBBLE_SIZE + 'px'
    bubbleTextEl.style.lineHeight = BUBBLE_LINE + 'px'
    bubbleTextEl.style.left = (BUBBLE_PAD + 2) + 'px'
    bubbleTextEl.textContent = lines.join('\n')
  }

  // Moving the bubble only changes its frame and tail, never text measurement or wrapping.
  function drawBubbleFrame(tailCenterX, tailUp) {
    var w = bubbleW
    var h = bubbleH
    bubbleTextEl.style.top = ((tailUp ? TAIL_H : 0) + BUBBLE_PAD + 1) + 'px'
    var tailX = Math.round(Math.min(
      Math.max(8, (tailCenterX || w / 2) - TAIL_W / 2),
      w - TAIL_W - 8,
    ))
    var key = [w, h, tailX, !!tailUp, BUBBLE_CORNER, TAIL_W, TAIL_H].join(':')
    if (key === bubbleFrameKey) return
    bubbleFrameKey = key
    bubbleSvg.setAttribute('width', String(w + 6))
    bubbleSvg.setAttribute('height', String(h + 6))
    bubbleSvg.setAttribute('viewBox', `0 0 ${w + 6} ${h + 6}`)
    bubbleSvg.innerHTML =
      '<path d="' + bubblePath(w, h, tailX, tailUp) + '" fill="#000" fill-opacity=".32" transform="translate(3,3)"/>' +
      '<path d="' + bubblePath(w, h, tailX, tailUp) + '" fill="#ffffff" stroke="#20232a" stroke-width="2"/>'

  }

  function fmtMoney(value, currency) {
    if (value === null || value === undefined) return '--'
    var n = Number(value)
    if (!isFinite(n)) return '--'
    return (currency === 'USD' ? '$' : '¥') + n.toFixed(2)
  }

  /** HH:MM:SS（倒计时显示用） */
  function hhmmss(ms) {
    var totalMinutes = Math.max(0, Math.round(ms / 60000))
    var pad = function (n) { return String(n).padStart(2, '0') }
    var h = Math.floor(totalMinutes / 60)
    var m = totalMinutes % 60
    return pad(h) + '时' + pad(m) + '分'
  }
  function bubbleLines() {
    // 事件反馈期间**只显示反馈内容**，不掺余额/花费/峰谷
    if (bubbleEventText && Date.now() < bubbleEventUntil) {
      return interactionText ? [bubbleEventText, interactionText] : [bubbleEventText]
    }
    var lines = []
    var s = getState()
    if (bubbleMode === 'quota') {
      const usage = quotaLines(s)
      return usage.length ? ['博士，已连接账户的余额在这儿。', ...usage] : []
    }
    if (interactionText) return [interactionText]
    if (s?.closureCompanion) return lines
    var b = s && s.balance
    if (b && b.ok) {
      lines.push('余额 ' + fmtMoney(b.total, b.currency) + (b.low ? ' 要花光了哦！' : '') + (b.stale ? ' 未刷新' : ''))
    } else if (b && b.signedOut) {
      lines.push('博士还没有登录CLSR哦')
    } else {
      lines.push('嗯……余额数据还没同步')
    }
    if (s) {
      var sp = s.spend
      if (sp) {
        var parts = ['今天花掉 ' + fmtMoney(sp.today, 'CNY')]
        if (Number(sp.turnAmount) > 0) parts.push('本轮消耗 ' + fmtMoney(sp.turnAmount, 'CNY'))
        lines.push(parts.join(' · '))
      }
      var peak = s.period === 'peak'
      var left = s.periodNextChangeAt ? Math.max(0, s.periodNextChangeAt - Date.now()) : null
      lines.push((peak ? '峰时' : '谷时') + (left !== null ? ' 距' + (peak ? '谷时' : '峰时') + hhmmss(left) : ''))
    }
    return lines
  }

  function placeBubble() {
    if (!bubbleEl || !pet.pos) return { tailCenter: bubbleW / 2, below: false }
    var s = size()
    var bounds = deps.getPetBounds ? deps.getPetBounds() : { left: pet.pos.x, top: pet.pos.y, width: s.w, height: s.h }
    var centerX = bounds.left + bounds.width / 2
    // 尾巴不放在正中：气泡主体朝屏幕内侧展开，尾巴落在宽度的 32% / 68% 处
    var ratio = centerX < window.innerWidth / 2 ? 0.32 : 0.68
    var left = Math.round(centerX - bubbleW * ratio)
    left = Math.min(Math.max(8, left), Math.max(8, window.innerWidth - bubbleW - 6 - 8))
    var top = Math.round(bounds.top - bubbleH - 2)
    var below = top < 8
    if (below) top = Math.round(bounds.top + bounds.height + 2)
    top = Math.min(Math.max(8, top), Math.max(8, window.innerHeight - bubbleH - 6 - 8))
    bubbleEl.style.left = left + 'px'
    bubbleEl.style.top = top + 'px'
    // 弹出动画的轴心：在桌宠上方时用底边，翻到下方时用顶边
    bubbleEl.style.transformOrigin = below ? 'center top' : 'center bottom'
    // 尾巴仍然指向桌宠中心；气泡被夹到边缘时跟着偏移，但保证不贴边
    var tailCenter = Math.min(
      Math.max(TAIL_W / 2 + 8, centerX - left),
      Math.max(TAIL_W / 2 + 8, bubbleW - TAIL_W / 2 - 8),
    )
    return { tailCenter: tailCenter, below: below }
  }

  function refreshBubble() {
    if (!pet.skeleton || !pet.pos) return
    ensureFont()
    ensureBubble()
    var lines = bubbleLines()
    if (!lines.length) { hideBubble(); return }
    // 1) 先按占位尾巴量出尺寸；2) 用真实尺寸判定上下/左右；3) 用正确尾巴重画再落位
    renderBubble(lines, 0, false)
    var pos = placeBubble()
    drawBubbleFrame(pos.tailCenter, pos.below)
    return true
  }

  function followBubble(duration = 0) {
    if (!bubbleShown || !bubbleEl || !pet.pos) return
    // During edge snapping, follow the rendered position throughout the CSS transition.
    bubbleFollowUntil = Math.max(bubbleFollowUntil, performance.now() + duration)
    if (bubbleFollowRaf) return
    bubbleFollowRaf = requestAnimationFrame(function follow(now) {
      bubbleFollowRaf = 0
      if (!bubbleShown || !bubbleEl || !pet.pos) return
      var pos = placeBubble()
      drawBubbleFrame(pos.tailCenter, pos.below)
      if (now < bubbleFollowUntil) bubbleFollowRaf = requestAnimationFrame(follow)
    })
  }

  // 气泡显隐动画：像从桌宠头顶"冒"出来（底部为轴心），带一点回弹
  var bubbleShown = false
  function popBubbleIn() {
    if (!bubbleEl) return
    bubbleEl.style.opacity = '1'
    try { bubbleEl.getAnimations().forEach(function (a) { a.cancel() }) } catch (err) {}
    try {
      bubbleEl.animate([
        { opacity: 0, transform: 'scale(.62,.7) translateY(10px)' },
        { opacity: 1, transform: 'scale(1.06,1.03) translateY(-2px)', offset: 0.62 },
        { opacity: 1, transform: 'scale(.98,1.01) translateY(1px)', offset: 0.8 },
        { opacity: 1, transform: 'scale(1,1) translateY(0)' },
      ], { duration: 320, easing: 'cubic-bezier(.22,1.5,.36,1)', fill: 'forwards' })
    } catch (err) {}
  }

  function popBubbleOut() {
    stopFollowing()
    if (!bubbleEl) return
    try {
      bubbleEl.getAnimations().forEach(function (a) { a.cancel() })
      bubbleEl.animate([
        { opacity: 1, transform: 'scale(1,1)' },
        { opacity: 0, transform: 'scale(.92,.94) translateY(4px)' },
      ], { duration: 180, easing: 'ease-in', fill: 'forwards' })
    } catch (err) {}
    bubbleEl.style.opacity = '0'
  }

  function showInteraction() {
    if (Date.now() < bubbleEventUntil || (taskDialogueShown && bubbleMode !== 'interaction')) return
    const scene = deps.standalone ? 'standalone' : 'working'
    if (deps.macOS && !settings.bubble) {
      const id = nextSceneVoice(scene)
      if (id) audio.playVoice(id).catch(() => {})
      return
    }
    showDialogue(scene, '', 0, 'interaction')
  }

  function nextSceneVoice(scene) {
    const standalone = scene === 'standalone'
    const queue = standalone ? getStandaloneVoiceQueue(settings) : getVoiceQueues(settings)[scene]
    const queueMode = standalone ? settings.standaloneVoiceQueueMode : settings.voiceQueueMode
    return nextVoice(queueMode + ':' + scene, queue)
  }

  let taskDialogueShown = false
  function showDialogue(scene, eventText = '', eventMs = 0, mode = scene) {
    if (!settings.bubble || document.hidden || (!eventText && Date.now() < bubbleEventUntil)) return false
    if (taskDialogueShown && (mode === 'working' || mode === 'idle' || mode === 'startup')) return false
    const id = nextSceneVoice(scene)
    if (!id) return false
    showBubble(eventText, eventMs, dialogue[id][1], mode)
    taskDialogueShown = true
    audio.playVoice(id, (duration) => {
      const visibleFor = Math.max(BUBBLE_HIDE_MS, eventMs, duration + 250)
      if (eventText) bubbleEventUntil = Date.now() + visibleFor
      scheduleHide(visibleFor)
    }).catch(() => {})
    return true
  }

  function showQuota() {
    if (!settings.bubble || !quotaLines(getState()).length) return false
    showBubble(null, null, '', 'quota')
    return true
  }

  async function playQueuedDialogue(scene, eventText = '') {
    const id = nextSceneVoice(scene)
    if (!id && !eventText) return
    const displayTime = settings.bubble ? BUBBLE_HIDE_MS : 0
    if (displayTime) {
      showBubble(eventText, displayTime, id ? dialogue[id][1] : '', scene)
      taskDialogueShown = true
    }
    const holdBubble = () => new Promise((resolve) => setTimeout(resolve, displayTime))
    if (!id) return holdBubble()
    let finishVoice
    const ended = new Promise((resolve) => { finishVoice = resolve })
    const played = await audio.playVoice(id, (duration) => {
      if (settings.bubble) {
        const visibleFor = Math.max(displayTime, duration + 250)
        if (eventText) bubbleEventUntil = Date.now() + visibleFor
        scheduleHide(visibleFor)
      }
    }, false, finishVoice).catch(() => false)
    if (!played) finishVoice()
    await Promise.all([ended, holdBubble()])
  }

  function showBubble(eventText, eventMs, clickedLine = '', mode = 'info') {
    if (!settings.bubble) return
    taskDialogueShown = false
    audio.stopVoice()
    ensureFont()
    var wasVisible = bubbleShown
    interactionText = clickedLine
    if (eventText) {
      bubbleEventText = eventText
      bubbleEventUntil = Date.now() + (eventMs || 3600)
      bubbleMode = 'event'
    } else {
      bubbleEventText = ''
      bubbleEventUntil = 0
      bubbleMode = mode
    }
    if (!refreshBubble()) return
    bubbleShown = true
    // 新内容才重新"弹"一次；只是刷新数字时不打断动画
    if (!wasVisible || eventText || clickedLine || mode === 'quota') popBubbleIn()
    else bubbleEl.style.opacity = '1'
    // ⚠️ 事件气泡到"文字过期"就收起，**不能**拖到 5.2s：
    //    否则过期后内容会回落成余额/花费，看起来像"思考中突然弹余额"。
    var hideIn = bubbleMode === 'event'
      ? Math.max(700, bubbleEventUntil - Date.now())
      : BUBBLE_HIDE_MS
    scheduleHide(hideIn)
    if (!bubbleTickTimer) {
      bubbleTickTimer = setInterval(function () {
        if (!bubbleShown) {
          clearInterval(bubbleTickTimer); bubbleTickTimer = 0
          return
        }
        // 事件文字已过期 → 直接收气泡（不显示常规内容）
        if (bubbleMode === 'event' && Date.now() > bubbleEventUntil) {
          bubbleShown = false
          popBubbleOut()
          clearInterval(bubbleTickTimer); bubbleTickTimer = 0
          return
        }
        refreshBubble()
      }, 1000)
    }
  }

  function scheduleHide(delay) {
    clearTimeout(bubbleHideTimer)
    bubbleHideTimer = setTimeout(function () {
      bubbleShown = false
      taskDialogueShown = false
      audio.stopVoice()
      popBubbleOut()
      if (bubbleTickTimer) { clearInterval(bubbleTickTimer); bubbleTickTimer = 0 }
    }, delay)
  }

  function dispose() {
    hideBubble()
    if (bubbleHideTimer) { clearTimeout(bubbleHideTimer); bubbleHideTimer = 0 }
    if (bubbleTickTimer) { clearInterval(bubbleTickTimer); bubbleTickTimer = 0 }
    if (bubbleEl && bubbleEl.parentNode) bubbleEl.parentNode.removeChild(bubbleEl)
    bubbleEl = null
    bubbleTextEl = null
    bubbleTailEl = null
    bubbleSvg = null
    bubbleFrameKey = ''
  }

  return { show: showBubble, showDialogue, playQueuedDialogue, showQuota: showQuota, showInteraction: showInteraction, refresh: refreshBubble, follow: followBubble, hide: hideBubble,
    hideDialogue: () => { if (bubbleMode !== 'quota') hideBubble() }, dispose: dispose, isShown: function () { return bubbleShown } }
}
