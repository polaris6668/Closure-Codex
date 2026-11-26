import { TOKENS } from './palette.mjs'

const ID = 'dsh-closure-codex-theme'
const ATTRIBUTE = 'data-closure-dsh-theme'
const CSS = '__CLOSURE_DSH_CSS__'
export const inject = ['theme']

// DOM seats are verified from the public layout attributes, never CSS hashes,
// translated labels, or chat contents. No element is moved or replaced.
function locate(doc) {
  const frame = doc.querySelector('[data-shell-overlay]')?.parentElement
  if (!frame) return []
  const sidebar = [...frame.children].find(node => node.querySelector('[data-sidebar-toggle]'))
  const sidebarRoot = sidebar?.querySelector('[data-sidebar-toggle]')
  let root = sidebarRoot?.parentElement
  while (root && root.parentElement !== sidebar) root = root.parentElement
  // Slots wrap the concrete sidebar in display:contents; that wrapper has no
  // geometry or painted box. Decorate its rendered root instead.
  while (root?.hasAttribute('data-slot')) root = root.firstElementChild
  const center = sidebar?.nextElementSibling
  const rightbar = center?.nextElementSibling
  const childWithSlot = slot => [...(root?.children || [])].find(node =>
    node.matches(`[data-slot="${slot}"]`) || node.querySelector(`[data-slot="${slot}"]`)) || null
  // DSH's preload measures this hidden swatch and forwards its colour to the
  // native Windows caption. Make only that swatch transparent, so the system
  // buttons reveal our page background without changing sidebar surface tokens.
  const captionProbe = doc.documentElement.hasAttribute('data-windows-titlebar')
    ? [...doc.body.children].find(node => node.tagName === 'SPAN' &&
      node.style.position === 'fixed' && node.style.visibility === 'hidden' && node.style.pointerEvents === 'none' &&
      node.style.backgroundColor === 'var(--dsw-specific-sidebar-fill)' && node.style.color === 'var(--dsw-alias-label-primary)')
    : null
  return [frame, sidebar || null, root || null, center || null,
    rightbar?.hasAttribute('data-rightbar-col') ? rightbar : null, root?.querySelector('nav') || null,
    childWithSlot('sidebar.session.action'), childWithSlot('sidebar.settings'), captionProbe || null]
}

function mount(doc) {
  const root = doc.documentElement
  const previous = root.getAttribute(ATTRIBUTE)
  const style = doc.createElement('style')
  style.dataset.plugin = ID
  style.textContent = CSS
  doc.head.append(style)
  root.setAttribute(ATTRIBUTE, 'on')
  const classes = ['frame', 'sidebar-column', 'sidebar', 'center', 'rightbar', 'navigation',
    'session-actions', 'footer', 'caption-probe'].map(part => `closure-dsh-${part}`)
  const ownedClasses = new Map()
  const ownedStyles = new Map()
  let elements = [], disposed = false, queued = false, nativeProbe, resizeFrame = null
  const view = doc.defaultView
  // Publish measured paint widths outside ResizeObserver's delivery cycle.
  // The host has its own observers for the responsive sidebar layout.
  const resize = new view.ResizeObserver(() => {
    if (resizeFrame !== null) return
    resizeFrame = view.requestAnimationFrame(() => { resizeFrame = null; measure() })
  })

  function restoreStyles(node, values) {
    for (const [name, [value, priority]] of values) {
      if (value) node.style.setProperty(name, value, priority)
      else node.style.removeProperty(name)
    }
  }

  function setVariable(node, name, value) {
    if (!node || node.style.getPropertyValue(name) === value) return
    let values = ownedStyles.get(node)
    if (!values) ownedStyles.set(node, values = new Map())
    if (!values.has(name)) values.set(name, [node.style.getPropertyValue(name), node.style.getPropertyPriority(name)])
    node.style.setProperty(name, value)
  }

  function measure() {
    if (disposed) return
    const [frame, column] = elements
    if (!frame || !column) return
    // The column clips a frozen-width sidebar during collapse; measure the
    // visible column so the shared background follows its actual edge.
    const box = column.getBoundingClientRect()
    setVariable(frame, '--closure-dsh-menu-width', `${box.width}px`)
  }

  function refresh() {
    queued = false
    if (disposed) return
    if (!style.isConnected) doc.head.append(style)
    const next = locate(doc)
    if (next.length !== elements.length || next.some((node, index) => node !== elements[index])) {
      resize.disconnect()
      for (const [node, name] of ownedClasses) {
        if (!next.some((element, index) => element === node && classes[index] === name)) {
          node.classList.remove(name)
          ownedClasses.delete(node)
        }
      }
      for (const [node, values] of ownedStyles) if (!next.includes(node)) {
        restoreStyles(node, values)
        ownedStyles.delete(node)
      }
      elements = next
      next.slice(0, 2).filter(Boolean).forEach(node => resize.observe(node))
    }
    // React can replace the whole class attribute while keeping the same node
    // (sidebar hover, collapse, resize); rebind before the next paint.
    next.forEach((node, index) => {
      if (node && !node.classList.contains(classes[index])) {
        node.classList.add(classes[index])
        ownedClasses.set(node, classes[index])
      }
    })
    if (next[8] && nativeProbe !== next[8]) {
      nativeProbe = next[8]
      // The preload observes the head for theme changes, not its private swatch.
      // Reseat our sheet once to request the native colour update after binding.
      doc.head.append(style)
    }
    measure()
  }
  const observer = new view.MutationObserver(records => {
    if (disposed || queued) return
    if (!records.some(record => record.type === 'childList' || record.target === root || elements.includes(record.target))) return
    queued = true
    view.queueMicrotask(refresh)
  })
  observer.observe(doc.body, { childList: true, subtree: true, attributes: true,
    attributeFilter: ['class', 'data-sidebar-collapsed', 'data-sidebar-drawer'] })
  observer.observe(doc.head, { childList: true })
  observer.observe(doc.documentElement, { attributes: true, attributeFilter: ['data-windows-titlebar', 'data-fullscreen'] })
  view.addEventListener('resize', measure)
  refresh()
  return () => {
    disposed = true
    observer.disconnect()
    resize.disconnect()
    if (resizeFrame !== null) view.cancelAnimationFrame(resizeFrame)
    view.removeEventListener('resize', measure)
    for (const [node, name] of ownedClasses) node.classList.remove(name)
    for (const [node, values] of ownedStyles) restoreStyles(node, values)
    style.remove()
    if (previous === null) root.removeAttribute(ATTRIBUTE)
    else root.setAttribute(ATTRIBUTE, previous)
  }
}

export function apply(ctx) {
  // A registered theme id is temporary in DSH. Reapply after asynchronous
  // durable-preference hydration, remembering that latest preference for unload.
  ctx.effect(() => {
    const theme = ctx.theme
    let restore = theme.getTheme().preference
    const unregister = theme.register({ id: ID, colorScheme: 'dark', tokens: TOKENS })
    let disposed = false, scheduled = false
    const select = () => {
      scheduled = false
      if (!disposed && theme.getTheme().preference !== ID) theme.setTheme(ID)
    }
    const off = ctx.on('theme/change', snapshot => {
      if (disposed || snapshot.preference === ID) return
      restore = snapshot.preference
      if (!scheduled) { scheduled = true; queueMicrotask(select) }
    })
    theme.setTheme(ID)
    const unmount = typeof document === 'undefined' ? () => {} : mount(document)
    return () => {
      disposed = true
      off()
      unmount()
      if (theme.getTheme().preference === ID) {
        const available = restore === 'system' || theme.getTheme().themes.some(item => item.id === restore)
        theme.setTheme(available ? restore : 'system')
      }
      unregister()
    }
  }, `${ID}: appearance and layout`)
}
