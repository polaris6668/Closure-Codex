const macOS = new URLSearchParams(location.search).get('macOS') === '1'
let petTarget = false
let controlsActive = false

function near(element, x, y) {
  if (!element) return false
  const { left, right, top, bottom, width, height } = element.getBoundingClientRect()
  const margin = 12
  return width > 0 && height > 0 && x >= left - margin && x <= right + margin &&
    y >= top - margin && y <= bottom + margin
}

window.closureCompanion.onCursor(({ x, y, avoid }) => {
  const withinWindow = x >= 0 && y >= 0 && x < innerWidth && y < innerHeight
  const panel = document.getElementById('dsh-closure-pet-settings')
  const panelTarget = withinWindow && panel?.contains(document.elementFromPoint(x, y))
  const hit = withinWindow && window.__dshClosurePet?.hitTest?.(x, y)
  const dragging = document.documentElement.classList.contains('dshcl-dragging')
  const controls = Boolean(dragging || panelTarget)
  const target = Boolean(hit)
  if (petTarget !== target || controlsActive !== controls) {
    petTarget = target
    controlsActive = controls
    window.closureCompanion.setInteractive(target, controls)
  }
  if (macOS) {
    let conceal = false
    if (avoid && withinWindow && !controls) {
      const pet = document.getElementById('dsh-closure-pet')
      const bubble = document.getElementById('dsh-closure-pet-bubble')
      conceal = near(pet, x, y) || (bubble?.style.opacity === '1' && near(bubble, x, y))
    }
    document.documentElement.classList.toggle('closure-pointer-avoidance', conceal)
  }
})
