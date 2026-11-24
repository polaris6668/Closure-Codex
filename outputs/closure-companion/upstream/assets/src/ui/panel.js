// dsh-closure-pet — 设置面板（工厂）
//
// 依赖注入：settings / saveSettings / resolveFlip / layout / repositionForAnchor /
// applyOpacity / hideBubble / audioEnsure / loadSounds / playSound / size / pet / resetPosition。
// 面板 DOM 懒创建（第一次 open 时），关闭只是 display:none。

import { PREFIX, SIZE_MIN, SIZE_MAX } from '../core/env.js'
import { FPS_MIN, FPS_MAX, BUBBLE_FONT_MIN, BUBBLE_FONT_MAX, BUBBLE_SCALE_MIN, BUBBLE_SCALE_MAX, VOICE_LANGUAGES } from '../shared/protocol.js'
import { createVoiceQueues } from './voice-queues.js'

export function createPanel(deps) {
  var settings = deps.settings
  var saveSettings = deps.saveSettings
  var resolveFlip = deps.resolveFlip
  var layout = deps.layout
  var repositionForAnchor = deps.repositionForAnchor
  var applyOpacity = deps.applyOpacity
  var hideBubble = deps.hideBubble
  var audioEnsure = deps.audioEnsure
  var loadSounds = deps.loadSounds
  var playSound = deps.playSound
  var size = deps.size
  var pet = deps.pet
  var resetPosition = deps.resetPosition

  // ————————————————————— 设置面板 —————————————————————
  var panel = null
  function panelIsOpen() { return !!(panel && panel.style.display === 'block') }

  function buildPanel() {
    panel = document.createElement('div')
    panel.id = 'dsh-closure-pet-settings'
    panel.style.cssText = [
      'position:fixed', 'z-index:2147482001', 'display:none',
      'pointer-events:auto', 'min-width:196px', 'padding:10px 12px',
      'border-radius:10px', 'font:12px/1.6 ui-sans-serif,system-ui,"Microsoft YaHei",sans-serif',
      'background:rgba(26,28,36,.97)', 'color:#e7eaf3',
      'border:1px solid rgba(255,255,255,.14)',
      'box-shadow:0 10px 30px rgba(0,0,0,.45)',
      'box-sizing:border-box', 'max-height:calc(100vh - 16px)', 'overflow:auto',
    ].join(';')

    function row(label) {
      var el = document.createElement('div')
      el.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:10px;margin:4px 0'
      var name = document.createElement('span')
      name.textContent = label
      name.style.cssText = 'color:#aab2c8'
      el.appendChild(name)
      panel.appendChild(el)
      return el
    }

    const runtimeControls = {}
    const runtimeStatus = document.createElement('div')
    runtimeStatus.setAttribute('role', 'status')
    runtimeStatus.style.cssText = 'color:#ffb8c9;max-width:260px'
    function disableRuntime(disabled) {
      Object.values(runtimeControls).forEach((input) => { input.disabled = disabled })
    }
    function syncRuntime(value) {
      for (const [key, input] of Object.entries(runtimeControls)) input.checked = value[key] === true
      runtimeStatus.textContent = value.startupError || ''
    }
    async function refreshRuntime() {
      if (!deps.getRuntimeSettings) return
      disableRuntime(true)
      try {
        const value = await deps.getRuntimeSettings()
        if (!value) throw new Error('No settings')
        syncRuntime(value)
      } catch {
        runtimeStatus.textContent = '设置未读取，请重新打开菜单。'
      } finally {
        disableRuntime(false)
        positionPanel()
      }
    }
    if (deps.setRuntimeSetting) {
      for (const [key, label] of [['codexLinked', 'Codex 联动'], ['showOutsideCodex', '在桌面和其他软件中显示'], ['startAtLogin', '开机自启']]) {
        const settingRow = row(label)
        const checkbox = document.createElement('input')
        checkbox.type = 'checkbox'
        checkbox.checked = key === 'codexLinked' ? !deps.standalone : key === 'showOutsideCodex'
        checkbox.setAttribute('aria-label', label)
        runtimeControls[key] = checkbox
        checkbox.addEventListener('change', async () => {
          const previous = !checkbox.checked
          disableRuntime(true)
          runtimeStatus.textContent = ''
          try {
            const result = await deps.setRuntimeSetting(key, checkbox.checked)
            if (!result?.ok) throw new Error(result?.error || '设置未保存，请重试。')
            syncRuntime(result)
          } catch (error) {
            checkbox.checked = previous
            runtimeStatus.textContent = error.message
          } finally {
            disableRuntime(false)
            positionPanel()
          }
        })
        settingRow.appendChild(checkbox)
      }
      panel.appendChild(runtimeStatus)
    }

    // 镜像
    var mirrorRow = row('镜像')
    var segBox = document.createElement('span')
    segBox.style.cssText = 'display:inline-flex;border:1px solid rgba(255,255,255,.18);border-radius:7px;overflow:hidden'
    var mirrorButtons = {}
    ;[['auto', '自动'], ['always', '始终'], ['never', '不镜像']].forEach(function (pair) {
      var btn = document.createElement('button')
      btn.textContent = pair[1]
      btn.dataset.value = pair[0]
      btn.style.cssText = 'padding:3px 9px;border:0;background:transparent;color:#cfd6e6;font:inherit;cursor:pointer'
      btn.addEventListener('click', function () {
        settings.mirror = pair[0]
        saveSettings()
        resolveFlip()
        syncMirrorButtons()
      })
      mirrorButtons[pair[0]] = btn
      segBox.appendChild(btn)
    })
    mirrorRow.appendChild(segBox)
    function syncMirrorButtons() {
      Object.keys(mirrorButtons).forEach(function (k) {
        var on = settings.mirror === k
        mirrorButtons[k].style.background = on ? 'rgba(125,134,255,.85)' : 'transparent'
        mirrorButtons[k].style.color = on ? '#fff' : '#cfd6e6'
      })
    }

    // 大小
    var sizeRow = row('大小')
    var sizeWrap = document.createElement('span')
    sizeWrap.style.cssText = 'display:inline-flex;align-items:center;gap:8px'
    var slider = document.createElement('input')
    slider.type = 'range'
    slider.min = String(SIZE_MIN)
    slider.max = String(SIZE_MAX)
    slider.step = '0.05'
    slider.value = String(settings.size)
    slider.style.cssText = 'width:96px;accent-color:#7d86ff;cursor:pointer'
    var sizeText = document.createElement('span')
    sizeText.style.cssText = 'width:34px;text-align:right;color:#cfd6e6'
    sizeText.textContent = Math.round(settings.size * 100) + '%'
    var saveTimer = 0
    slider.addEventListener('input', function () {
      settings.size = Math.min(SIZE_MAX, Math.max(SIZE_MIN, Number(slider.value) || 1))
      sizeText.textContent = Math.round(settings.size * 100) + '%'
      layout()
      repositionForAnchor()
      clearTimeout(saveTimer)
      saveTimer = setTimeout(saveSettings, 250)
    })
    sizeWrap.appendChild(slider)
    sizeWrap.appendChild(sizeText)
    sizeRow.appendChild(sizeWrap)

    const fpsRow = row('帧率')
    const fpsWrap = document.createElement('span')
    fpsWrap.style.cssText = 'display:inline-flex;align-items:center;gap:8px'
    const fpsSlider = document.createElement('input')
    fpsSlider.type = 'range'
    fpsSlider.min = String(FPS_MIN)
    fpsSlider.max = String(FPS_MAX)
    fpsSlider.step = '1'
    fpsSlider.setAttribute('aria-label', '帧率')
    fpsSlider.style.cssText = 'width:96px;accent-color:#7d86ff;cursor:pointer'
    const fpsText = document.createElement('span')
    fpsText.style.cssText = 'width:42px;text-align:right;color:#cfd6e6'
    function syncFps() {
      fpsSlider.value = String(settings.fps)
      fpsText.textContent = settings.fps + ' FPS'
      fpsSlider.setAttribute('aria-valuetext', fpsText.textContent)
    }
    fpsSlider.addEventListener('input', function () {
      settings.fps = fpsSlider.valueAsNumber
      syncFps()
      saveSettings(false)
    })
    fpsWrap.append(fpsSlider, fpsText)
    fpsRow.appendChild(fpsWrap)

    // 气泡开关
    var bubbleRow = row('气泡')
    var bubbleBtn = document.createElement('button')
    bubbleBtn.style.cssText = 'padding:3px 10px;border-radius:7px;border:1px solid rgba(255,255,255,.18);' +
      'background:rgba(255,255,255,.06);color:#dfe4f0;font:inherit;cursor:pointer'
    function syncBubbleBtn() {
      bubbleBtn.textContent = settings.bubble ? '开' : '关'
      bubbleBtn.style.background = settings.bubble ? 'rgba(125,134,255,.85)' : 'rgba(255,255,255,.06)'
      bubbleBtn.style.color = settings.bubble ? '#fff' : '#dfe4f0'
    }
    bubbleBtn.addEventListener('click', function () {
      settings.bubble = !settings.bubble
      syncBubbleBtn()
      saveSettings(true)
      if (!settings.bubble) hideBubble()
    })
    syncBubbleBtn()
    bubbleRow.appendChild(bubbleBtn)

    const bubbleControls = []
    function bubbleSlider(label, key, min, max, step, format) {
      const settingRow = row(label)
      const wrap = document.createElement('span')
      wrap.style.cssText = 'display:inline-flex;align-items:center;gap:8px'
      const input = document.createElement('input')
      input.type = 'range'
      input.min = String(min)
      input.max = String(max)
      input.step = String(step)
      input.setAttribute('aria-label', label)
      input.style.cssText = 'width:96px;accent-color:#7d86ff;cursor:pointer'
      const value = document.createElement('span')
      value.style.cssText = 'width:42px;text-align:right;color:#cfd6e6'
      function sync() {
        input.value = String(settings[key])
        value.textContent = format(settings[key])
        input.setAttribute('aria-valuetext', value.textContent)
      }
      input.addEventListener('input', function () {
        settings[key] = input.valueAsNumber
        sync()
        saveSettings(false)
        deps.refreshBubble()
      })
      wrap.append(input, value)
      settingRow.appendChild(wrap)
      bubbleControls.push(sync)
      sync()
      return settingRow
    }
    bubbleSlider('对话字号', 'bubbleFontSize', BUBBLE_FONT_MIN, BUBBLE_FONT_MAX, 1, value => value + ' px')
    bubbleSlider('气泡大小', 'bubbleScale', BUBBLE_SCALE_MIN, BUBBLE_SCALE_MAX, 0.05, value => Math.round(value * 100) + '%')
      .title = '调整气泡宽度与留白，文字由对话字号独立控制。'
    function syncBubbleControls() { bubbleControls.forEach(sync => sync()) }

    // 透明度
    var opaRow = row('透明度')
    var opaWrap = document.createElement('span')
    opaWrap.style.cssText = 'display:inline-flex;align-items:center;gap:8px'
    var opaSlider = document.createElement('input')
    opaSlider.type = 'range'
    opaSlider.min = '0.3'
    opaSlider.max = '1'
    opaSlider.step = '0.05'
    opaSlider.value = String(settings.opacity)
    opaSlider.style.cssText = 'width:96px;accent-color:#7d86ff;cursor:pointer'
    var opaText = document.createElement('span')
    opaText.style.cssText = 'width:38px;text-align:right;color:#cfd6e6'
    opaText.textContent = Math.round(settings.opacity * 100) + '%'
    opaSlider.addEventListener('input', function () {
      settings.opacity = Math.min(1, Math.max(0.3, Number(opaSlider.value) || 1))
      opaText.textContent = Math.round(settings.opacity * 100) + '%'
      applyOpacity()
      saveSettings(false)
    })
    opaWrap.appendChild(opaSlider)
    opaWrap.appendChild(opaText)
    opaRow.appendChild(opaWrap)

    // 音效：开关 + 音量
    var soundRow = row('音效')
    var soundWrap = document.createElement('span')
    soundWrap.style.cssText = 'display:inline-flex;align-items:center;gap:8px'
    var soundBtn = document.createElement('button')
    soundBtn.style.cssText = 'padding:3px 9px;border-radius:7px;border:1px solid rgba(255,255,255,.18);' +
      'background:rgba(255,255,255,.06);color:#dfe4f0;font:inherit;cursor:pointer'
    function syncSoundBtn() {
      soundBtn.textContent = settings.sound ? '开' : '关'
      soundBtn.style.background = settings.sound ? 'rgba(125,134,255,.85)' : 'rgba(255,255,255,.06)'
      soundBtn.style.color = settings.sound ? '#fff' : '#dfe4f0'
    }
    soundBtn.addEventListener('click', function () {
      settings.sound = !settings.sound
      syncSoundBtn()
      saveSettings(true)
      if (settings.sound) { audioEnsure(); loadSounds(); playSound('click') }
    })
    syncSoundBtn()
    function volumeControl(label, key, onInput) {
      const control = document.createElement('span')
      control.style.cssText = 'display:inline-flex;align-items:center;gap:8px'
      const slider = document.createElement('input')
      slider.type = 'range'
      slider.min = '0'
      slider.max = '1'
      slider.step = '0.05'
      slider.value = String(settings[key])
      slider.setAttribute('aria-label', label)
      slider.style.cssText = 'width:74px;accent-color:#7d86ff;cursor:pointer'
      const percent = document.createElement('span')
      percent.style.cssText = 'width:34px;text-align:right;color:#cfd6e6'
      percent.textContent = Math.round(Number(slider.value) * 100) + '%'
      slider.addEventListener('input', () => {
        settings[key] = Number(slider.value)
        percent.textContent = Math.round(settings[key] * 100) + '%'
        onInput?.()
        saveSettings(false)
      })
      control.append(slider, percent)
      return control
    }
    const effectsVolume = volumeControl('音效音量', 'volume')
    effectsVolume.addEventListener('change', function () { if (settings.sound) { audioEnsure(); playSound('click') } })
    soundWrap.appendChild(soundBtn)
    soundWrap.appendChild(effectsVolume)
    soundRow.appendChild(soundWrap)

    const voiceRow = row('角色配音')
    const voiceQueues = createVoiceQueues({ ...deps, positionPanel })
    const voiceSwitch = document.createElement('input')
    voiceSwitch.type = 'checkbox'
    voiceSwitch.checked = settings.voice
    voiceSwitch.setAttribute('aria-label', '角色配音')
    voiceSwitch.addEventListener('change', () => {
      settings.voice = voiceSwitch.checked
      saveSettings(true)
      deps.updateVoice()
      if (voiceQueues?.menu.open) voiceQueues.refresh()
    })
    voiceRow.appendChild(voiceSwitch)
    row('配音音量').appendChild(volumeControl('配音音量', 'voiceVolume', deps.setVoiceVolume))

    const languageRow = row('配音语言')
    const languageGroup = document.createElement('div')
    languageGroup.style.cssText = 'display:grid;grid-template-columns:repeat(2,1fr);gap:4px'
    const languageButtons = []
    for (const [language, label] of Object.entries(VOICE_LANGUAGES)) {
      const button = document.createElement('button')
      button.type = 'button'
      button.textContent = label
      button.dataset.voiceLanguage = language
      button.style.cssText = 'padding:3px 6px;border:1px solid #545969;border-radius:6px;color:inherit;font:inherit;cursor:pointer'
      button.addEventListener('click', () => {
        settings.voiceLanguage = language
        saveSettings(true)
        deps.updateVoice()
        syncVoiceLanguage()
      })
      languageButtons.push(button)
      languageGroup.appendChild(button)
    }
    function syncVoiceLanguage() {
      for (const button of languageButtons) {
        const selected = button.dataset.voiceLanguage === settings.voiceLanguage
        button.setAttribute('aria-pressed', String(selected))
        button.style.background = selected ? '#525ca9' : '#303442'
      }
    }
    languageRow.appendChild(languageGroup)
    syncVoiceLanguage()
    if (voiceQueues) panel.appendChild(voiceQueues.menu)

    const previews = document.createElement('details')
    previews.style.cssText = 'margin-top:8px;border-top:1px solid #444958;padding-top:5px'
    const previewHeading = document.createElement('summary')
    previewHeading.textContent = '预览表情'
    previewHeading.style.cursor = 'pointer'
    previews.appendChild(previewHeading)
    const previewButtons = document.createElement('div')
    previewButtons.style.cssText = 'display:grid;grid-template-columns:repeat(2,1fr);gap:4px;margin:5px 0'
    for (const [label, name, index] of [
      ['哭脸', 'Sad_Begin'], ['委屈待机', 'Sad_Idle'], ['庆祝', 'Happy'], ['开场', 'Special_A'],
      ['思考', 'Special_B'], ['说话', 'Talk'], ['互动一', 'Interact', 0], ['互动二', 'Interact', 1],
    ]) {
      const button = document.createElement('button')
      button.textContent = label
      button.style.cssText = 'padding:3px 6px;border:1px solid #545969;border-radius:6px;background:#303442;color:inherit;font:inherit;cursor:pointer'
      button.addEventListener('click', function () { closePanel(); deps.preview(name, index) })
      previewButtons.appendChild(button)
    }
    previews.appendChild(previewButtons)
    previews.addEventListener('toggle', positionPanel)
    panel.appendChild(previews)

    if (location.protocol === 'closure-pet:' && !deps.standalone) {
      const notifications = document.createElement('details')
      notifications.style.cssText = previews.style.cssText
      const heading = document.createElement('summary')
      heading.textContent = '提醒与播报'
      heading.style.cursor = 'pointer'
      notifications.appendChild(heading)

      const quotaRow = row('自动额度提醒')
      const options = document.createElement('span')
      options.style.cssText = 'display:inline-flex;gap:4px'
      for (const [minutes, label] of [[0, '关闭'], [1, '每分钟'], [5, '每五分钟']]) {
        const button = document.createElement('button')
        button.type = 'button'
        button.textContent = label
        button.dataset.minutes = String(minutes)
        button.style.cssText = 'padding:3px 6px;border:1px solid #545969;border-radius:6px;color:inherit;font:inherit;cursor:pointer'
        button.addEventListener('click', () => {
          settings.quotaReminderMinutes = minutes
          saveSettings(true)
          syncQuotaOptions()
        })
        options.appendChild(button)
      }
      function syncQuotaOptions() {
        for (const button of options.children) {
          const selected = Number(button.dataset.minutes) === settings.quotaReminderMinutes
          button.setAttribute('aria-pressed', String(selected))
          button.style.background = selected ? '#525ca9' : '#303442'
        }
      }
      syncQuotaOptions()
      quotaRow.appendChild(options)
      notifications.appendChild(quotaRow)

      {
        const key = 'toolFailureNotice'
        const label = '工具失败提示'
        const settingRow = row(label)
        const checkbox = document.createElement('input')
        checkbox.type = 'checkbox'
        checkbox.checked = settings[key]
        checkbox.setAttribute('aria-label', label)
        checkbox.addEventListener('change', () => {
          settings[key] = checkbox.checked
          saveSettings(true)
        })
        settingRow.appendChild(checkbox)
        notifications.appendChild(settingRow)
      }
      notifications.addEventListener('toggle', positionPanel)
      panel.appendChild(notifications)
    }

    if (deps.themeAction) {
      const appearance = document.createElement('details')
      appearance.style.cssText = previews.style.cssText
      const summary = document.createElement('summary')
      summary.textContent = 'Codex 配色与 CRT'
      summary.style.cursor = 'pointer'
      appearance.appendChild(summary)
      const status = document.createElement('div')
      status.setAttribute('role', 'status')
      status.style.cssText = 'max-width:235px;color:#c7cfdf'
      const run = async (name) => {
        try {
          const result = await deps.themeAction(name)
          status.textContent = result?.message || ''
        } catch {
          status.textContent = '主题操作失败。'
        } finally { positionPanel() }
      }
      for (const [name, text] of [['copy', '复制深色配色'], ['enable', '启动 CRT 版 Codex'], ['disable', '关闭 CRT']]) {
        const button = document.createElement('button')
        button.type = 'button'
        button.textContent = text
        button.dataset.themeAction = name
        button.style.cssText = 'margin:4px 4px 3px 0;padding:3px 6px;border:1px solid #545969;border-radius:6px;background:#303442;color:inherit;cursor:pointer'
        button.addEventListener('click', () => run(name))
        appearance.appendChild(button)
      }
      appearance.appendChild(status)
      appearance.addEventListener('toggle', () => { if (appearance.open) run('status'); positionPanel() })
      panel.appendChild(appearance)
    }

    // 操作
    var actions = document.createElement('div')
    actions.style.cssText = 'display:flex;gap:8px;margin-top:9px'
    function action(label, fn) {
      var b = document.createElement('button')
      b.textContent = label
      b.style.cssText = 'flex:1;padding:5px 8px;border-radius:7px;border:1px solid rgba(255,255,255,.18);' +
        'background:rgba(255,255,255,.06);color:#dfe4f0;font:inherit;cursor:pointer'
      b.addEventListener('click', fn)
      actions.appendChild(b)
    }
    action('重置位置', function () { resetPosition() })
    if (deps.macOS && !deps.standalone && deps.showQuota) {
      action('查看用量', function () {
        if (deps.showQuota()) closePanel()
        else runtimeStatus.textContent = '暂时没有用量或额度数据，或桌宠正在播报。'
      })
    }
    action('完成', function () { closePanel() })
    panel.appendChild(actions)

    if (deps.quit) {
      const quitButton = document.createElement('button')
      quitButton.type = 'button'
      quitButton.textContent = '退出桌宠'
      quitButton.style.cssText = 'display:block;width:100%;margin-top:8px;padding:5px 8px;border-radius:7px;' +
        'border:1px solid rgba(255,150,170,.3);background:rgba(255,100,130,.08);color:#ffb8c9;font:inherit;cursor:pointer'
      quitButton.addEventListener('click', deps.quit)
      panel.appendChild(quitButton)
    }

    document.body.appendChild(panel)
    syncMirrorButtons()
    return { syncMirrorButtons, slider, sizeText, syncFps, syncBubbleControls, voiceQueues, refreshRuntime }
  }

  var panelApi = null
  function openPanel() {
    if (!panel) panelApi = buildPanel()
    if (panelApi) {
      panelApi.slider.value = String(settings.size)
      panelApi.sizeText.textContent = Math.round(settings.size * 100) + '%'
      panelApi.syncFps()
      panelApi.syncBubbleControls()
      panelApi.syncMirrorButtons()
      panelApi.refreshRuntime()
    }
    panel.style.display = 'block'
    if (panelApi.voiceQueues?.menu.open) panelApi.voiceQueues.refresh()
    positionPanel()
  }

  function positionPanel() {
    if (!panelIsOpen()) return
    // 放在桌宠上方；下方放不下就放下方
    var s = size()
    var pw = panel.offsetWidth
    var ph = panel.offsetHeight
    var left = Math.max(8, Math.min(pet.pos.x + s.w / 2 - pw / 2, window.innerWidth - pw - 8))
    var top = pet.pos.y - ph - 8
    if (top < 8) top = Math.max(8, Math.min(window.innerHeight - ph - 8, pet.pos.y + s.h + 8))
    panel.style.left = Math.round(left) + 'px'
    panel.style.top = Math.round(top) + 'px'
  }

  function closePanel() {
    if (panel) panel.style.display = 'none'
    deps.stopVoicePreview()
  }

  function insidePanel(target) {
    return !!(panel && target && panel.contains(target))
  }

  function dispose() {
    if (panel && panel.parentNode) panel.parentNode.removeChild(panel)
    panel = null
    panelApi = null
  }

  return { open: openPanel, close: closePanel, isOpen: panelIsOpen, contains: insidePanel, dispose: dispose }
}
