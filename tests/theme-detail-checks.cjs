const assert = require('node:assert/strict')

async function checkFolder(win, selector, expanded) {
  const clip = await win.webContents.executeJavaScript(`(() => {
    const {x, y, width, height} = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect()
    return {x: Math.round(x), y: Math.round(y), width, height}
  })()`)
  assert.deepEqual([clip.width, clip.height], [16, 16], 'Keep the native folder dimensions')
  // A computed image URL can be present even when Chromium still paints the original SVG.
  const wc = win.webContents
  await wc.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))')
  const pixels = (await wc.capturePage(clip)).toBitmap()
  let folderFill = 0, paper = 0
  for (let i = 0; i < pixels.length; i += 4) {
    const blue = pixels[i], green = pixels[i + 1], red = pixels[i + 2]
    if (Math.abs(red - 97) < 12 && Math.abs(green - 103) < 12 && Math.abs(blue - 126) < 12) folderFill++
    if (red > 218 && green > 218 && blue > 225) paper++
  }
  assert.ok(folderFill >= 12, `Missing pixel folder body for ${selector}`)
  assert.equal(paper >= 3, expanded, 'Only the open folder shows the pale paper')
}

async function checkCodePanel(win, {header, body, copy}) {
  const wc = win.webContents
  const element = selector => `document.querySelector(${JSON.stringify(selector)})`
  const paint = selector => `getComputedStyle(${element(selector)})`
  assert.equal(await wc.executeJavaScript(`${paint(header)}.backgroundColor`), 'rgb(40, 40, 56)')
  assert.match(await wc.executeJavaScript(`${paint(header)}.boxShadow`), /rgb\(82, 75, 101\) 0px -1px 0px 0px inset/)
  assert.equal(await wc.executeJavaScript(`${paint(body)}.backgroundColor`), 'rgb(24, 25, 36)')

  const button = element(copy)
  const checkHighlight = async state => {
    const matches = `${button}.matches('${state}') && ${paint(copy)}.backgroundColor === 'rgb(82, 75, 101)' && ${paint(copy)}.color === 'rgb(238, 240, 255)'`
    for (let frame = 0; frame < 30; frame++) {
      if (await wc.executeJavaScript(matches)) return
      await new Promise(resolve => setTimeout(resolve, 16))
    }
    assert.fail(`Copy did not brighten on ${state} in ${header}`)
  }
  await wc.executeJavaScript(`${button}.focus({focusVisible:true})`)
  await checkHighlight(':focus-visible')
  await wc.executeJavaScript(`${button}.blur()`)
  const point = await wc.executeJavaScript(`(() => {
    const b = ${button}.getBoundingClientRect()
    return {x: Math.floor(b.x + b.width / 2), y: Math.floor(b.y + b.height / 2)}
  })()`)
  await wc.debugger.sendCommand('Input.dispatchMouseEvent', {type:'mouseMoved', ...point})
  await checkHighlight(':hover')
  await wc.debugger.sendCommand('Input.dispatchMouseEvent', {type:'mouseMoved', x:1, y:1})
}

module.exports = {checkFolder, checkCodePanel}
