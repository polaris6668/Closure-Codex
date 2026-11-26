// dsh-closure-pet — 前端组合根
//
// 行为约定（沿用鲸鱼挂件）：
//   · 位移² < 9（<3px）= 点击，否则 = 拖拽
//   · 拖拽 1:1 跟手，松手 settle() 滑向吸附位（横/纵轴各按 1/4 区独立判定）
//   · 按下桌宠到松手之间「冻结」页面交互：不选区、不拖图、不悬停高亮、不点穿
//   · 一律 left/top 像素定位；位置存 localStorage['dshcl-pos']
//
// 设置项：见 core/settings.js（右键桌宠打开面板）
//
// 交互动画：Interact 共 5.93s，按动作节奏在中点切成前后两段，
//   点击时随机播其中一段，播完用 0.35s 交叉淡化（blendspace 等价物）回 Idle。
//
// 模块划分（P1：纯搬迁，行为不变）：
//   core/env.js         常量 / 日志
//   core/settings.js    设置读写与持久化
//   render/hit-test.js  静态命中区（图元 → 128×108 掩码）
//   anim/library.js     动画数据表（循环区间 / 模式 / 参数）
//   audio.js            音效（工厂）
//   ui/layout.js        位置 / 吸附 / 翻转（工厂）
//   main.js             组合根：DOM、渲染循环、状态机、交互、面板、轮询、开屏

import {
  PREFIX, MODEL, CANVAS_W, FRAME, FRAMING, DRAG_THRESHOLD_SQ, SIZE_MIN, SIZE_MAX,
  INTERACT_SPLIT, INTERACT_MIX, STARTUP_DELAY, log, warn,
} from './core/env.js'
import { settings, saveSettings } from './core/settings.js'
import { normalizeSettings } from './shared/protocol.js'
import { HIT_MASK_W, HIT_MASK_H, HIT_GROW, HIT_FORMS, buildHitMask, maskHit } from './render/hit-test.js'
import { LOOP_RANGES, LOOP_MODES, THINK_NOD_MIN_MS, THINK_NOD_MAX_MS, HAPPY_CHANCE } from './anim/library.js'
import { createAudio } from './audio.js'
import { createLayout } from './ui/layout.js'
import { createPanel } from './ui/panel.js'
import { createBubble } from './ui/bubble.js'
import { createSticker } from './ui/sticker.js'
import { createDrag } from './input/drag.js'
import { createDirector } from './anim/director.js'
import { createState } from './io/state.js'

(function () {
  if (window.__dshClosurePet) return
  window.__dshClosurePet = { phase: 'boot' }
  const query = new URLSearchParams(location.search)
  const macOS = query.get('macOS') === '1'
  const standalone = query.get('codexLinked') === 'false' || query.get('mode') === 'standalone'

  // ————————————————————— 设置 —————————————————————
  // settings / loadSettings / saveSettings 见 core/settings.js（加载时已合并 localStorage）

  // ————————————————————— DOM —————————————————————
  var host = document.createElement('div')
  host.id = 'dsh-closure-pet'
  host.style.cssText = [
    'position:fixed', 'left:0', 'top:0',
    'z-index:2147482000', 'pointer-events:none',
    'user-select:none', 'opacity:0', 'will-change:transform',
    'transition:opacity .35s ease',
  ].join(';')

  var canvas = document.createElement('canvas')
  canvas.style.cssText = 'display:block;width:100%;height:100%;transition:transform .28s ease'
  host.appendChild(canvas)

  var note = document.createElement('div')
  note.style.cssText = 'display:none;font:11px/1.4 ui-sans-serif,system-ui,"Microsoft YaHei",sans-serif;color:#ff8f8f;text-align:center;max-width:280px;white-space:pre-line;overflow-wrap:anywhere'
  host.appendChild(note)

  function mount() {
    if (!document.body || document.getElementById('dsh-closure-pet')) return
    var mount = window.__dshClosurePetMount
    var parent = (mount && mount.container) || document.body
    parent.appendChild(host)
  }
  if (document.body) mount()
  else document.addEventListener('DOMContentLoaded', mount, { once: true })

  function fail() {
    window.__dshClosurePet.phase = 'failed'
    window.__dshClosurePet.error = '桌宠资源或渲染组件初始化失败。'
    note.textContent = '嗯？我这边没启动起来。博士，你看这条报错。\n' + window.__dshClosurePet.error
    note.style.display = 'block'
    host.style.opacity = '1'
    warn(window.__dshClosurePet.error)
  }

  var pet = {
    skeleton: null, state: null, stateData: null, renderer: null, gl: null, camera: null,
    raf: 0, lastTime: 0, current: null, segment: null, frames: 0, afterOverlay: null,
    interactDuration: 0,
    flipped: false,
    pos: null, anchor: null,
  }

  // ————————————————————— 尺寸 / 相机 —————————————————————
  function layout() {
    if (!pet.skeleton) return
    var dpr = Math.min(window.devicePixelRatio || 1, 2)
    var cssW = Math.round(CANVAS_W * settings.size)
    var cssH = Math.round(cssW * (FRAME.h / FRAME.w))
    host.style.width = cssW + 'px'
    host.style.height = cssH + 'px'
    var cw = Math.round(cssW * dpr)
    var ch = Math.round(cssH * dpr)
    if (canvas.width !== cw) canvas.width = cw
    if (canvas.height !== ch) canvas.height = ch

    if (pet.mode === 'canvas') {
      // 2D 降级：世界坐标 (x, y) → 画布像素，Y 轴翻转
      var cscale = Math.max(cw / (FRAME.w * FRAMING), ch / (FRAME.h * FRAMING))
      var fcx = FRAME.x + FRAME.w / 2
      var fcy = FRAME.y + FRAME.h / 2
      pet.canvasScale = cscale
      pet.canvasTx = cw / 2 - fcx * cscale
      pet.canvasTy = ch / 2 + fcy * cscale
      applyPosition()
      return
    }
    // ⚠️ Spine 3.8 的 OrthoCamera.zoom 是**乘**在正交边界上的：
    //     projection = ortho(zoom * -vw/2, zoom * vw/2, zoom * -vh/2, zoom * vh/2)
    //   ⇒ 可见世界宽度 = zoom * 画布宽度。所以要"装下 FRAME 这个世界尺寸"，
    //     zoom 必须是 (目标世界尺寸 / 画布尺寸)，取两轴中较大的那个。
    var zoom = Math.max((FRAME.w * FRAMING) / cw, (FRAME.h * FRAMING) / ch)
    var cam = pet.camera
    cam.setViewport(cw, ch)
    cam.zoom = zoom
    cam.position.x = FRAME.x + FRAME.w / 2
    cam.position.y = FRAME.y + FRAME.h / 2
    pet.gl.viewport(0, 0, cw, ch)
    pet.gl.clearColor(0, 0, 0, 0)
    applyPosition()
  }

  // ————————————————————— 位置 / 吸附 / 翻转 —————————————————————
  // 实现在 ui/layout.js（工厂）；这里解构出来，保持调用点不变。
  var layoutUi = createLayout({ host: host, canvas: canvas, settings: settings, pet: pet })
  var size = layoutUi.size
  var clampPos = layoutUi.clampPos
  var applyPosition = layoutUi.applyPosition
  var setFlipped = layoutUi.setFlipped
  var applyOpacity = layoutUi.applyOpacity
  var resolveFlip = layoutUi.resolveFlip
  var defaultPos = layoutUi.defaultPos
  var loadPos = layoutUi.loadPos
  var savePos = layoutUi.savePos
  var placeFromStorage = layoutUi.placeFromStorage
  var repositionForAnchor = layoutUi.repositionForAnchor
  var settle = layoutUi.settle

  // ————————————————————— 命中测试（静态命中区）—————————————————————
  // 图元定义与栅格化在 render/hit-test.js；这里只做屏幕坐标 → 归一化 → 镜像 → 查表。
  var hitMask = null

  function hitTest(clientX, clientY) {
    if (!hitMask) hitMask = buildHitMask()
    var rect = canvas.getBoundingClientRect()
    if (!rect.width || !rect.height) return false
    var nx = (clientX - rect.left) / rect.width
    var ny = (clientY - rect.top) / rect.height
    if (pet.flipped) nx = 1 - nx
    return maskHit(hitMask, nx, ny)
  }

  // ————————————————————— 播放（分层）—————————————————————
  // 状态机在 anim/director.js；这里创建实例并保持调用点不变。
  var director = createDirector({
    pet: pet, log: log,
    // audio 别名在下面音效分节才赋值，用 getter 惰性取（否则 playSegment 会拿到 undefined）
    getAudioEnsure: function () { return audioEnsure },
    getPlaySound: function () { return playSound },
    getStartupHold: function () { return startupHold },
    setStartupHold: function (v) { startupHold = v },
  })
  var layers = director.layers
  var desiredName = director.desiredName
  var playLoop = director.playLoop
  var startAnimation = director.startAnimation
  var syncAnimation = director.syncAnimation
  var segmentRange = director.segmentRange
  var playSegment = director.playSegment
  var playOverlay = director.playOverlay
  var endSegment = director.endSegment

  var frameBudget = 0
  var animationElapsed = 0

  function frame(now) {
    pet.raf = requestAnimationFrame(frame)
    if (!pet.lastTime) {
      pet.lastTime = now
      return
    }
    var elapsed = (now - pet.lastTime) / 1000
    pet.lastTime = now

    frameBudget += elapsed
    animationElapsed += Math.min(elapsed, 1 / 30)
    var step = 1 / settings.fps
    if (frameBudget < step - 0.001) return
    // 保留不足一帧的余量，避免高刷屏每次舍入都丢时间。卡顿后仍只画一帧。
    frameBudget -= Math.max(1, Math.floor(frameBudget / step)) * step
    var dt = animationElapsed
    animationElapsed = 0

    pet.state.update(dt)
    // 思考循环：手动推相位（entry.timeScale 已置 0，update 不会自己走）
    if (pet.think && pet.current === 'Special_B') {
      var th = pet.think
      if (th.stage === 'intro') {
        th.phase += dt
        if (th.phase >= th.from) {
          th.phase = th.from
          th.stage = 'nod'
          th.dir = 1
          th.nodUntil = Date.now() + THINK_NOD_MIN_MS + Math.random() * (THINK_NOD_MAX_MS - THINK_NOD_MIN_MS)
        }
      } else if (th.stage === 'nod') {
        th.phase += dt * th.dir
        if (th.phase >= th.to) { th.phase = th.to; th.dir = -1 }
        else if (th.phase <= th.from) { th.phase = th.from; th.dir = 1 }
        if (Date.now() >= th.nodUntil) th.stage = 'outro'
      } else {
        th.phase += dt
        if (th.phase >= th.dur) { th.stage = 'intro'; th.phase = 0; th.dir = 1 }
      }
      var thEntry = pet.state.getCurrent(0)
      if (thEntry) thEntry.trackTime = Math.min(th.phase, th.dur - 0.002)
    }

    // 乒乓：手动推相位（entry.timeScale 已置 0，update 不会自己走）
    if (pet.pingpong && pet.current === pet.pingpong.name) {
      var pp = pet.pingpong
      pp.phase += dt * pp.dir
      if (pp.phase >= pp.to) { pp.phase = pp.to; pp.dir = -1 }
      else if (pp.phase <= pp.from) { pp.phase = pp.from; pp.dir = 1 }
      var ppEntry = pet.state.getCurrent(0)
      if (ppEntry) ppEntry.trackTime = pp.phase
    }
    pet.state.apply(pet.skeleton)
    pet.skeleton.updateWorldTransform()

    if (pet.segment && pet.segment.entry.trackTime >= pet.segment.to) endSegment()

    // 循环区间（wrap 模式）：到 to 就回卷到 from（保持相位，不重新 setAnimation）
    // 乒乓模式下由上面的相位逻辑接管，这里必须跳过，否则会在端点被强行拉回起点。
    var loopMode = LOOP_MODES[pet.current]
    var range = LOOP_RANGES[pet.current]
    if ((!loopMode || loopMode === 'wrap') && range && range.to > range.from + 0.05) {
      var cur = pet.state.getCurrent(0)
      if (cur && cur.trackTime >= range.to) {
        var span = range.to - range.from
        cur.trackTime = range.from + ((cur.trackTime - range.to) % span)
      }
    }

    if (pet.mode === 'canvas') {
      // 2D 降级渲染
      var ctx2 = pet.ctx
      ctx2.setTransform(1, 0, 0, 1, 0, 0)
      ctx2.clearRect(0, 0, canvas.width, canvas.height)
      ctx2.setTransform(pet.canvasScale, 0, 0, -pet.canvasScale, pet.canvasTx, pet.canvasTy)
      ctx2.imageSmoothingEnabled = true
      try { pet.renderer.draw(pet.skeleton) } catch (err) { /* 单帧绘制失败不影响循环 */ }
      pet.frames++
      return
    }

    var gl = pet.gl
    gl.clear(gl.COLOR_BUFFER_BIT)
    pet.renderer.begin()
    pet.renderer.drawSkeleton(pet.skeleton, false)
    pet.renderer.end()
    pet.frames++
  }

  function start() {
    resume()
    host.style.opacity = '1'
    window.__dshClosurePet.phase = 'running'
  }

  function resume() {
    if (!pet.raf && !document.hidden) pet.raf = requestAnimationFrame(frame)
  }

  function stop() {
    if (pet.raf) cancelAnimationFrame(pet.raf)
    pet.raf = 0
    pet.lastTime = 0
    frameBudget = 0
    animationElapsed = 0
  }

  // 页面卸载 / 客户端插件销毁时调用：撤掉监听、定时器与 DOM，可重复调用。
  function dispose() {
    try { stop() } catch (err) {}
    if (startupTimer) { clearTimeout(startupTimer); startupTimer = 0 }
    if (resizeTimer) { clearTimeout(resizeTimer); resizeTimer = 0 }
    try { if (stateApi) stateApi.dispose() } catch (err) {}
    try { if (dragApi) dragApi.dispose() } catch (err) {}
    try { if (bubbleApi) bubbleApi.dispose() } catch (err) {}
    try { if (stickerApi) stickerApi.dispose() } catch (err) {}
    try { if (panelUi) panelUi.dispose() } catch (err) {}
    try { window.removeEventListener('resize', onResize) } catch (err) {}
    try { document.removeEventListener('visibilitychange', onVisibility) } catch (err) {}
    if (host && host.parentNode) host.parentNode.removeChild(host)
    hitMask = null
    window.__dshClosurePet.phase = 'disposed'
  }

  // ————————————————————— 设置面板 —————————————————————
  // 实现在 ui/panel.js；实例在模块末尾（组合阶段）创建，这里先放薄委托。
  var panelUi = null
  function openPanel() { if (panelUi) panelUi.open() }
  function closePanel() { if (panelUi) panelUi.close() }
  function panelIsOpen() { return panelUi ? panelUi.isOpen() : false }
  function insidePanel(target) { return panelUi ? panelUi.contains(target) : false }

  // ————————————————————— 交互：点击 / 拖拽 / 右键 —————————————————————
  // 实现在 input/drag.js；监听在组合阶段注册。
  var dragApi = null

  // ————————————————————— 视口变化 —————————————————————
  var resizeTimer = 0
  function onResize() {
    if (window.__dshClosurePet.phase !== 'running') return
    clearTimeout(resizeTimer)
    resizeTimer = setTimeout(function () {
      layout(); repositionForAnchor()
      if (bubbleApi?.isShown()) refreshBubble()
    }, 200)
  }
  window.addEventListener('resize', onResize)

  function onVisibility() {
    if (window.__dshClosurePet.phase !== 'running') return
    if (document.hidden) {
      if (dragApi) dragApi.cancelDrag() // 切后台时可能收不到 pointerup，先把挡板和拦截器撤掉
      audio.stopVoice()
      closePanel()
      stop()
      if (!standalone) setPollInterval(5000)
    } else {
      resume()
      if (startupPending && startupPending.companion && !startupTimer) {
        startupTimer = setTimeout(runStartup, STARTUP_DELAY)
      }
      if (!standalone) {
        setPollInterval(1000)
        pollState()
      }
    }
  }
  document.addEventListener('visibilitychange', onVisibility)

  function resetPosition() {
    pet.pos = defaultPos()
    pet.anchor = { h: 'right', v: 'bottom' }
    host.style.transition = 'left .22s ease, top .22s ease, opacity .35s ease'
    resolveFlip()
    applyPosition()
    savePos()
  }

  // ————————————————————— 音效 —————————————————————
  // 实现在 audio.js（工厂）；解构方法，保持调用点不变。
  var audio = createAudio(function () { return settings })
  var audioEnsure = audio.ensure
  var loadSounds = audio.loadSounds
  var playSound = audio.playSound

  // ————————————————————— 气泡（像素风）—————————————————————
  // 实现在 ui/bubble.js；实例在组合阶段创建。
  var bubbleApi = null
  function showBubble(eventText, eventMs) { if (bubbleApi) bubbleApi.show(eventText, eventMs) }
  function refreshBubble() { if (bubbleApi) bubbleApi.refresh() }
  function hideBubble() { if (bubbleApi) bubbleApi.hide() }

  // ————————————————————— 谷价贴画（−50% 扫描线）—————————————————————
  // 实现在 ui/sticker.js；实例在组合阶段创建。
  var stickerApi = null
  function showValleySticker() { if (stickerApi) stickerApi.show() }

  // ————————————————————— P4：宿主状态轮询 —————————————————————
  // 实现在 io/state.js；实例在组合阶段创建。
  var stateApi = null
  function applyState(s) { if (stateApi) stateApi.applyState(s) }
  function pollState() { if (stateApi) stateApi.pollState() }
  function startPolling() { if (stateApi) stateApi.startPolling() }
  function setPollInterval(ms) { if (stateApi) stateApi.setPollInterval(ms) }
  function loadHostConfig() { if (stateApi) stateApi.loadHostConfig() }

  // ————————————————————— 开屏时序 —————————————————————
  // STARTUP_DELAY 定义在文件顶部的可调参数区。
  //
  // 语义：延迟到点后**强制插播**——不管当下是否在思考/输出、是否有覆盖动画，
  // 都先演一遍开屏（峰谷 → 可选余额），演完再回到原本的工作层/基础层。
  var startupTimer = 0
  var startupPending = null
  var startupHold = false // 开屏两段之间的空档：暂停状态驱动的动画切换

  function scheduleStartup(peak, low, companion) {
    startupPending = { peak: !!peak, low: !!low, companion: !!companion }
    clearTimeout(startupTimer)
    startupTimer = companion && document.hidden ? 0 : setTimeout(runStartup, STARTUP_DELAY)
  }

  function cancelStartup() {
    if (startupTimer) clearTimeout(startupTimer)
    startupTimer = 0
    startupPending = null
  }

  function runStartup() {
    clearTimeout(startupTimer)
    startupTimer = 0
    var p = startupPending
    if (p && p.companion && document.hidden) return
    startupPending = null
    if (!p || !pet.state) return
    if (p.companion) {
      p.low = false
      bubbleApi.showDialogue('startup')
    }
    // 强制插播：清掉 Talk 锁与挂起的覆盖动画，立刻把开屏演出来
    director.resetLocks()
    pet.segment = null
    playOverlay(p.peak ? 'Sad_Begin' : 'Special_A', function () { syncAnimation(true) })
  }

  // ————————————————————— 启动 —————————————————————
  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script')
      s.src = src
      s.async = true
      s.onload = function () { resolve() }
      s.onerror = function () { reject(new Error('script load failed: ' + src)) }
      document.head.appendChild(s)
    })
  }

  function fetchText(url) {
    return fetch(url, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error(url + ' -> HTTP ' + r.status)
      return r.text()
    })
  }

  function loadImage(url) {
    return new Promise(function (resolve, reject) {
      var img = new Image()
      img.onload = function () { resolve(img) }
      img.onerror = function () { reject(new Error('image load failed: ' + url)) }
      img.src = url
    })
  }

  // ————————————————————— 组合：创建 UI 实例 —————————————————————
  // 此时函数声明已提升、var 别名都已赋值，依赖全部就绪。
  panelUi = createPanel({
    standalone, macOS,
    getRuntimeSettings: window.closureCompanion?.getRuntimeSettings,
    setRuntimeSetting: window.closureCompanion?.setRuntimeSetting,
    themeAction: macOS ? window.closureCompanion?.themeAction : undefined,
    showQuota: () => !stateApi?.isPlayingTaskVoice() && bubbleApi?.showQuota(),
    quit: window.closureCompanion?.quit,
    settings: settings, saveSettings: saveSettings, resolveFlip: resolveFlip,
    layout: layout, repositionForAnchor: repositionForAnchor, applyOpacity: applyOpacity,
    hideBubble: hideBubble, refreshBubble: () => { if (bubbleApi?.isShown()) refreshBubble() },
    audioEnsure: audioEnsure, loadSounds: loadSounds, playSound: playSound,
    updateVoice: audio.stopVoice,
    previewVoice: (id) => {
      if (!settings.voice || document.hidden || (macOS && stateApi?.isPlayingTaskVoice())) return Promise.resolve(false)
      hideBubble()
      return audio.playVoice(id, undefined, true)
    },
    stopVoicePreview: audio.stopPreview,
    setVoiceVolume: audio.setVoiceVolume,
    size: size, pet: pet, resetPosition: resetPosition, preview: director.preview,
  })
  bubbleApi = createBubble({
    standalone, macOS,
    getPetBounds: () => host.getBoundingClientRect(),
    getState: function () { return stateApi ? stateApi.getState() : null }, pet: pet, size: size, settings: settings, audio,
  })
  stickerApi = createSticker({
    getState: function () { return stateApi ? stateApi.getState() : null }, pet: pet, size: size, settings: settings,
  })
  stateApi = createState({
    macOS,
    layers: layers, playOverlay: playOverlay, syncAnimation: syncAnimation,
    showBubble: showBubble, hideDialogue: bubbleApi.hideDialogue, refreshBubble: refreshBubble, playSound: playSound,
    showDialogue: bubbleApi.showDialogue, playQueuedDialogue: bubbleApi.playQueuedDialogue,
    resetActivity: () => { director.resetLocks(); pet.segment = null },
    scheduleStartup: scheduleStartup,
    settings: settings, saveSettings: saveSettings,
    layout: layout, repositionForAnchor: repositionForAnchor,
    resolveFlip: resolveFlip, applyOpacity: applyOpacity,
    isBubbleShown: function () { return !!(bubbleApi && bubbleApi.isShown()) },
  })
  dragApi = createDrag({
    hitTest: hitTest, pet: pet, host: host, clampPos: clampPos, applyPosition: applyPosition,
    settle: settle, followBubble: bubbleApi.follow, playSegment: playSegment,
    showBubble: () => { if (!macOS || !stateApi.isPlayingTaskVoice()) bubbleApi.showInteraction() },
    showValleySticker: showValleySticker,
    showQuota: () => !macOS || !stateApi.isPlayingTaskVoice() ? bubbleApi.showQuota() : false,
    openPanel: openPanel, closePanel: closePanel, panelIsOpen: panelIsOpen, insidePanel: insidePanel,
    stopPlayingVoice: () => {
      if (!macOS || !audio.getVoiceState()) return false
      audio.stopVoice()
      return true
    },
  })

  ;(async function boot() {
    try {
      // 1) 探测 WebGL：不可用（远程桌面 / 老显卡 / 禁用）就走 canvas 2D 降级
      var forceCanvas = /[?&]canvas=1/.test(location.search) ||
        (function () { try { return localStorage.getItem('dshcl-force-canvas') === '1' } catch (e) { return false } })()
      var gl = null
      if (!forceCanvas) {
        try {
          gl = canvas.getContext('webgl', {
            alpha: true,
            antialias: false,          // 像素画 + 透明贴图，MSAA 看不出收益，只多 4× 采样与每帧 resolve
            premultipliedAlpha: false,
            // 不再需要 preserveDrawingBuffer：命中测试已改成静态掩码，不读 GPU 像素
          })
        } catch (err) { gl = null }
      }

      var texts = await Promise.all([
        fetchText(PREFIX + '/assets/spine/' + MODEL + '.atlas'),
        fetchText(PREFIX + '/assets/spine/' + MODEL + '.json'),
      ])
      var image = await loadImage(PREFIX + '/assets/spine/' + MODEL + '.png')

      var atlas, data, skeleton
      if (gl) {
        await loadScript(PREFIX + '/assets/vendor/spine-webgl.js')
        if (!window.spine || !window.spine.webgl) throw new Error('spine-webgl 未挂载到 window.spine')
        pet.gl = gl
        pet.mode = 'gl'
        var context = new spine.webgl.ManagedWebGLRenderingContext(gl)
        atlas = new spine.TextureAtlas(texts[0], function () {
          return new spine.webgl.GLTexture(context, image)
        })
        data = new spine.SkeletonJson(new spine.AtlasAttachmentLoader(atlas)).readSkeletonData(JSON.parse(texts[1]))
        skeleton = new spine.Skeleton(data)
      } else {
        log('WebGL 不可用 → 使用 canvas 2D 降级')
        await loadScript(PREFIX + '/assets/vendor/spine-canvas.js')
        if (!window.spine || !window.spine.canvas) throw new Error('spine-canvas 未挂载到 window.spine')
        pet.mode = 'canvas'
        pet.ctx = canvas.getContext('2d')
        atlas = new spine.TextureAtlas(texts[0], function () {
          return new spine.canvas.CanvasTexture(image)
        })
        data = new spine.SkeletonJson(new spine.AtlasAttachmentLoader(atlas)).readSkeletonData(JSON.parse(texts[1]))
        skeleton = new spine.Skeleton(data)
        pet.mode = 'canvas'
      }

      var stateData = new spine.AnimationStateData(data)
      var names = data.animations.map(function (a) { return a.name })
      // Idle / 工作层 / 基础层之间互相切换用 0.18s；Interact 单独处理（进入 0、返回 INTERACT_MIX）
      var motion = ['Idle', 'Special_B', 'Talk', 'Happy', 'Sad_Begin', 'Sad_Idle', 'Special_A']
        .filter(function (n) { return names.indexOf(n) >= 0 })
      for (var i = 0; i < motion.length; i++) {
        for (var j = i + 1; j < motion.length; j++) {
          stateData.setMix(motion[i], motion[j], 0.18)
          stateData.setMix(motion[j], motion[i], 0.18)
        }
      }
      stateData.setMix('Idle', 'Interact', 0)
      stateData.setMix('Interact', 'Idle', INTERACT_MIX)
      motion.forEach(function (n) {
        stateData.setMix('Interact', n, 0.16)
        stateData.setMix(n, 'Interact', 0.16)
      })

      var state = new spine.AnimationState(stateData)
      var interact = data.animations.filter(function (a) { return a.name === 'Interact' })[0]
      pet.interactDuration = interact ? interact.duration : 5.93

      pet.skeleton = skeleton
      pet.state = state
      pet.stateData = stateData
      if (pet.mode === 'gl') {
        pet.renderer = new spine.webgl.SceneRenderer(canvas, context, false)
        pet.camera = pet.renderer.camera
      } else {
        pet.renderer = new spine.canvas.SkeletonRenderer(pet.ctx)
        pet.renderer.triangleRendering = true // 3.8 canvas 渲染器默认只画 RegionAttachment，网格需要三角形模式
      }

      layout()
      hitMask = buildHitMask()
      placeFromStorage()
      applyOpacity()
      playLoop('Idle', true)
      start()
      if (!standalone) startPolling()
      loadHostConfig()
      loadSounds()
      log('启动完成', names.length, 'animations · size', settings.size, '· mirror', settings.mirror)

      window.__dshClosurePet = {
        phase: 'running',
        animations: names,
        play: function (name, loop) {
          layers.overlay = null   // 手动播放视为最高优先级，先清掉覆盖层
          pet.segment = null
          loop ? playLoop(name, true) : playSegment2(name)
        },
        segments: function () { return [segmentRange(0), segmentRange(1)] },
        openPanel: openPanel,
        closePanel: closePanel,
        get settings() { return { mirror: settings.mirror, size: settings.size, bubble: settings.bubble, bubbleFontSize: settings.bubbleFontSize, bubbleScale: settings.bubbleScale, opacity: settings.opacity, sound: settings.sound, volume: settings.volume } },
        get split() { return INTERACT_SPLIT },
        setSettings: function (patch) {
          if (patch) {
            if (patch.mirror) settings.mirror = patch.mirror
            if (patch.size) settings.size = Number(patch.size)
            if (typeof patch.bubble === 'boolean') settings.bubble = patch.bubble
            Object.assign(settings, normalizeSettings({ bubbleFontSize: patch.bubbleFontSize, bubbleScale: patch.bubbleScale }, settings))
            if (patch.opacity) settings.opacity = Number(patch.opacity)
            if (typeof patch.sound === 'boolean') settings.sound = patch.sound
            if (patch.volume !== undefined) settings.volume = Number(patch.volume)
          }
          saveSettings(true); layout(); repositionForAnchor(); resolveFlip(); applyOpacity()
          if (!settings.bubble) hideBubble()
          else if (bubbleApi?.isShown()) refreshBubble()
        },
        resetPosition: resetPosition,
        hitTest: hitTest,
        applyState: applyState, // 调试用：手动灌一份 /state 数据
        showBubble: showBubble,
        showValleySticker: showValleySticker,
        hideBubble: hideBubble,
        get layers() { return { base: layers.base, work: layers.work, overlay: layers.overlay } },
        get loops() { return LOOP_RANGES },
        get sounds() { return audio.getState() },
        get voice() { return audio.getVoiceState() },
        playSound: playSound,
        runStartup: runStartup,
        cancelStartup: cancelStartup,
        get startup() { return { pending: !!startupPending, delay: STARTUP_DELAY, gap: 0 } },
        setLoop: function (name, from, to) {
          if (from === null || from === undefined) delete LOOP_RANGES[name]
          else LOOP_RANGES[name] = { from: Number(from), to: Number(to) }
          return LOOP_RANGES[name] || null
        },
        get trackTime() {
          var cur = pet.state && pet.state.getCurrent(0)
          return cur ? cur.trackTime : null
        },
        // 调试：把某个动画冻结在指定时刻并立刻画一帧（用于检查取景是否裁切）
        poseAt: function (name, time) {
          if (!pet.state) return null
          stop()
          layers.overlay = null
          pet.segment = null
          pet.pingpong = null
          pet.current = name
          pet.state.clearTracks()
          pet.skeleton.setToSetupPose()
          pet.skeleton.setSlotsToSetupPose()
          var e = pet.state.setAnimation(0, name, false)
          if (e) { e.trackTime = time; e.animationLast = time }
          pet.state.update(0)
          pet.state.apply(pet.skeleton)
          pet.skeleton.updateWorldTransform()
          var gl = pet.gl
          gl.clear(gl.COLOR_BUFFER_BIT)
          pet.renderer.begin()
          pet.renderer.drawSkeleton(pet.skeleton, false)
          pet.renderer.end()
          return { name: name, time: time }
        },
        dispose: dispose,
        resume: resume,
        get lastState() { return stateApi ? stateApi.getState() : null },
        get animation() {
          var cur = pet.state && pet.state.getCurrent(0)
          return cur && cur.animation ? cur.animation.name : null
        },
        get segmentInfo() { return pet.segment ? { to: pet.segment.to, index: pet.segment.index } : null },
        get position() { return pet.pos && { x: pet.pos.x, y: pet.pos.y, flipped: pet.flipped } },
        get debug() {
          var cam = pet.camera
          var vp = null
          try { vp = Array.from(pet.gl.getParameter(pet.gl.VIEWPORT)) } catch (err) { vp = String(err) }
          return {
            mode: pet.mode,
            dpr: Math.min(window.devicePixelRatio || 1, 2),
            cssW: host.offsetWidth, cssH: host.offsetHeight,
            canvasW: canvas.width, canvasH: canvas.height,
            glViewport: vp,
            frames: pet.frames,
            hitMask: { w: HIT_MASK_W, h: HIT_MASK_H, ready: !!hitMask, grow: HIT_GROW, forms: HIT_FORMS.length },
            zoom: cam && cam.zoom, camPos: cam && { x: cam.position.x, y: cam.position.y },
            camViewport: cam && { w: cam.viewportWidth, h: cam.viewportHeight },
            settings: { mirror: settings.mirror, size: settings.size },
          }
        },
      }
    } catch {
      fail()
    }
  })()

  // 调试用：按名字播一段单次动画（Interact 走分段逻辑）
  function playSegment2(name) {
    if (name === 'Interact') return playSegment()
    return playOverlay(name)
  }
})()
