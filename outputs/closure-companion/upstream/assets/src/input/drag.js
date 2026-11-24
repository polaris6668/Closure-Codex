// dsh-closure-pet — 点击 / 拖拽 / 右键（工厂）
//
// 拖动时冻结页面其它交互：命中 pointerdown 就 preventDefault + stopImmediatePropagation，
// 按下期间拦住 mousedown/selectstart/dragstart，铺透明挡板，松手吞掉合成 click。
// 依赖注入：hitTest / pet / host / clampPos / applyPosition / settle / followBubble /
// playSegment / showBubble / showValleySticker / openPanel / closePanel / panelIsOpen / insidePanel。

import { DRAG_THRESHOLD_SQ } from '../core/env.js'

export function createDrag(deps) {
  var hitTest = deps.hitTest
  var pet = deps.pet
  var host = deps.host
  var clampPos = deps.clampPos
  var applyPosition = deps.applyPosition
  var settle = deps.settle
  var followBubble = deps.followBubble
  var playSegment = deps.playSegment
  var showBubble = deps.showBubble
  var showValleySticker = deps.showValleySticker
  var openPanel = deps.openPanel
  var closePanel = deps.closePanel
  var panelIsOpen = deps.panelIsOpen
  var insidePanel = deps.insidePanel
  var listeners = []
  function listen(target, type, fn, opts) {
    target.addEventListener(type, fn, opts)
    listeners.push([target, type, fn, opts])
  }

  // ————————————————————— 交互：点击 / 拖拽 / 右键 —————————————————————
  // 拖动时要把页面其它交互「冻住」：文字被框选、图片/链接被原生拖走、悬停高亮乱闪，
  // 甚至指针滑到 iframe 上就被里面的文档抢走。五道闸，从源头到兜底：
  //   1. 命中桌宠的 pointerdown 直接 preventDefault + 阻断传播 —— 选区、焦点、
  //      原生拖拽都是这次按下的默认动作；页面的 pointerdown 监听也不再收到它；
  //   2. 按下到松手之间，在捕获阶段拦掉 mousedown / selectstart / dragstart
  //      （pointerdown 的 preventDefault 并不保证压掉兼容的 mousedown，必须再兜一层）；
  //   3. <html class="dshcl-dragging"> 期间 user-select:none、光标 grabbing；
  //   4. 铺一层透明挡板吃掉指针命中：页面收不到 hover，iframe / webview 也抢不走指针；
  //   5. 松手后吞掉浏览器顺手合成的那一次 click，避免"拖到按钮上松手就点出去了"。
  var drag = null
  var dragShield = null
  var dragStyle = null
  // 一次性开关：只吞「桌宠松手后紧跟的那个 click」，任何新的 pointerdown 都会撤销它
  var swallowClick = false
  var SHIELD_ID = 'dsh-closure-pet-drag-shield'
  var BLOCK_EVENTS = ['mousedown', 'selectstart', 'dragstart']
  var TOUCH_OPTS = { capture: true, passive: false }

  function blockDragEvent(e) {
    e.preventDefault()
    e.stopPropagation()
  }

  function ensureDragStyle() {
    if (dragStyle || !document.head) return
    dragStyle = document.createElement('style')
    dragStyle.id = 'dsh-closure-pet-drag-style'
    dragStyle.textContent = [
      'html.dshcl-dragging,html.dshcl-dragging body{',
      '-webkit-user-select:none !important;user-select:none !important;',
      'cursor:grabbing !important}',
      'html.dshcl-dragging *{cursor:grabbing !important}',
      // body 上的 -webkit-user-drag 不继承，图片和链接要单独点名
      'html.dshcl-dragging img,html.dshcl-dragging a{-webkit-user-drag:none !important}',
      // 触摸屏：手势开始后再改 touch-action 对本次手势无效，这里只对后续手势兜底
      'html.dshcl-dragging{touch-action:none !important;overscroll-behavior:contain}',
    ].join('')
    document.head.appendChild(dragStyle)
  }

  function beginDragLock(e) {
    ensureDragStyle()
    document.documentElement.classList.add('dshcl-dragging')
    if (!dragShield) {
      dragShield = document.createElement('div')
      dragShield.id = SHIELD_ID
      dragShield.setAttribute('aria-hidden', 'true')
      dragShield.style.cssText = [
        'position:fixed', 'left:0', 'top:0', 'width:100%', 'height:100%',
        'z-index:2147483000', 'pointer-events:auto', 'cursor:grabbing',
        'background:transparent', 'touch-action:none',
      ].join(';')
      ;(document.body || document.documentElement).appendChild(dragShield)
    }
    for (var i = 0; i < BLOCK_EVENTS.length; i++) {
      window.addEventListener(BLOCK_EVENTS[i], blockDragEvent, true)
    }
    window.addEventListener('touchmove', blockDragEvent, TOUCH_OPTS)
    // 这一下按下是桌宠的：连页面自己的 pointerdown 监听也不该收到（否则它们可能
    // setPointerCapture 把指针抢走，挡板就白铺了）。先 preventDefault 才能取消
    // 光标/选区/原生拖拽的默认动作；stopImmediatePropagation 连 window 上后注册的
    // 监听一起挡掉（比我们更早注册的监听拦不住，那是拿不到的先后顺序）。
    if (e) {
      try { e.preventDefault() } catch (err) {}
      try { e.stopImmediatePropagation() } catch (err) {}
    }
  }

  function endDragLock() {
    document.documentElement.classList.remove('dshcl-dragging')
    for (var i = 0; i < BLOCK_EVENTS.length; i++) {
      window.removeEventListener(BLOCK_EVENTS[i], blockDragEvent, true)
    }
    window.removeEventListener('touchmove', blockDragEvent, TOUCH_OPTS)
    if (dragShield && dragShield.parentNode) dragShield.parentNode.removeChild(dragShield)
    dragShield = null
  }

  // 放在 window 捕获阶段：比页面自己的 document/元素级监听都早，
  // 命中桌宠时才能把这次按下完整"截胡"（阻断传播后页面收不到它）。
  listen(window, 'pointerdown', function (e) {
    if (window.__dshClosurePet.phase !== 'running') return
    // 只要出现新的按下，就说明用户有了新意图：撤销上次松手留下的 click 吞口
    swallowClick = false
    if (insidePanel(e.target)) return
    if (e.button !== 0) return
    if (!hitTest(e.clientX, e.clientY)) {
      if (panelIsOpen()) closePanel()
      return
    }
    // 命中桌宠：这一次按下归桌宠，先冻住页面，页面不能拿它去选区 / 拖图 / 点按钮
    beginDragLock(e)
    var closedPanel = panelIsOpen()
    if (closedPanel) closePanel()
    drag = {
      pointerId: e.pointerId,
      startX: e.clientX, startY: e.clientY,
      originX: pet.pos.x, originY: pet.pos.y,
      moved: false,
      // 面板刚被这一下关掉：只冻结页面，不进入拖拽（免得"关面板"顺手把桌宠拖走）
      passive: closedPanel,
    }
    if (!closedPanel) host.style.transition = 'none'
  }, true)

  listen(window, 'pointermove', function (e) {
    if (!drag || e.pointerId !== drag.pointerId) return
    // 拖拽全程吃掉指针的默认动作（选区、文本光标、原生拖拽都从这儿开始）
    if (e.cancelable) { try { e.preventDefault() } catch (err) {} }
    if (drag.passive) return
    var dx = e.clientX - drag.startX
    var dy = e.clientY - drag.startY
    if (!drag.moved && dx * dx + dy * dy >= DRAG_THRESHOLD_SQ) {
      drag.moved = true
    }
    if (!drag.moved) return
    pet.pos = clampPos(drag.originX + dx, drag.originY + dy)
    applyPosition()
    followBubble()
  }, true)

  function endDrag(e) {
    if (!drag || (e && e.pointerId !== drag.pointerId)) return
    var wasDrag = drag.moved
    var passive = drag.passive
    drag = null
    endDragLock()
    // 松手后浏览器还会补一次 click；标记一下，让紧跟其后的那一下被吞掉。
    // pointercancel 不会合成 click，别把标记留到下一次真实点击。
    swallowClick = !(e && e.type === 'pointercancel')
    if (passive) return
    host.style.transition = 'opacity .35s ease'
    if (wasDrag) { settle(); followBubble(260) }
    else {
      const startSegment = !pet.segment
      if (startSegment) playSegment()
      showBubble() // 点击顺带把气泡叫出来
      if (startSegment) showValleySticker()
    }
  }

  // 拖拽中窗口失焦 / 切到后台：pointerup 可能永远不来，必须手动收尾，否则挡板会留在页面上
  function cancelDrag() {
    if (!drag) return
    var wasDrag = drag.moved
    drag = null
    endDragLock()
    host.style.transition = 'opacity .35s ease'
    if (wasDrag) { settle(); followBubble(260) }
  }

  listen(window, 'pointerup', endDrag, true)
  listen(window, 'pointercancel', endDrag, true)
  listen(window, 'blur', cancelDrag)

  // 吞掉"按下桌宠 → 松手"之后浏览器合成的那一次 click：
  // 否则桌宠正好压着按钮/链接时，拖完一松手就把下面的东西点出去了。
  // 只吞一次：任何新的 pointerdown 都会撤销标记，不会连累用户的下一次真实点击。
  // 放在 window 捕获阶段，页面自己的 click 监听（含 document 捕获级）都收不到这一下。
  listen(window, 'click', function (e) {
    if (!swallowClick) return
    swallowClick = false
    if (insidePanel(e.target)) return
    e.preventDefault()
    e.stopImmediatePropagation()
  }, true)

  listen(document, 'contextmenu', function (e) {
    if (window.__dshClosurePet.phase !== 'running') return
    if (insidePanel(e.target)) return
    if (!hitTest(e.clientX, e.clientY)) return
    e.preventDefault()
    if (deps.stopPlayingVoice?.()) return
    openPanel()
  }, true)

  listen(document, 'keydown', function (e) {
    if (e.key === 'Escape' && panelIsOpen()) closePanel()
  }, true)

  function dispose() {
    cancelDrag()
    for (var i = 0; i < listeners.length; i++) {
      var l = listeners[i]
      try { l[0].removeEventListener(l[1], l[2], l[3]) } catch (err) {}
    }
    listeners.length = 0
    if (dragShield && dragShield.parentNode) dragShield.parentNode.removeChild(dragShield)
    dragShield = null
    if (dragStyle && dragStyle.parentNode) dragStyle.parentNode.removeChild(dragStyle)
    dragStyle = null
    try { document.documentElement.classList.remove('dshcl-dragging') } catch (err) {}
  }

  return { isDragging: function () { return !!drag }, cancelDrag: cancelDrag, dispose: dispose }
}
