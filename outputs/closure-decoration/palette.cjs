const fs = require('node:fs/promises')
const path = require('node:path')

async function buildPalette() {
  const source = await fs.readFile(path.join(__dirname, '../closure-theme/closure-dark.txt'), 'utf8')
  if (!source.startsWith('codex-theme-v1:')) throw new Error('Invalid bundled theme')
  const parsed = JSON.parse(source.slice('codex-theme-v1:'.length))
  const theme = parsed.theme
  const colors = [theme.surface, theme.ink, theme.accent, ...Object.values(theme.semanticColors)]
  if (parsed.variant !== 'dark' || colors.some(value => !/^#[0-9a-f]{6}$/i.test(value))) throw new Error('Invalid dark palette')
  const { surface, ink, accent, semanticColors: semantic, fonts } = theme
  for (const font of [fonts.ui, fonts.code, fonts.content]) {
    if (typeof font !== 'string' || /[;{}<>]/.test(font)) throw new Error('Invalid bundled font stack')
  }
  const mix = (color, percent) => `color-mix(in srgb, ${surface}, ${color} ${percent}%)`
  const alpha = percent => `color-mix(in srgb, ${ink} ${percent}%, transparent)`
  const elevated = mix(ink, 6)
  const values = {
    '--codex-base-surface': surface, '--codex-base-ink': ink, '--codex-base-accent': accent,
    '--color-surface': surface, '--color-surface-card': surface,
    '--color-surface-secondary': surface, '--app-color-background-surface-under': surface,
    '--app-shell-sidebar-docked-background': 'var(--closure-sidebar)', '--wb-surface-secondary': surface,
    '--color-surface-tertiary': mix(ink, 5), '--color-surface-elevated': elevated,
    '--color-surface-elevated-secondary': mix(ink, 4), '--color-surface-recovery': surface,
    '--color-background-surface': surface, '--app-color-background-surface': surface,
    '--app-color-background-shell': surface, '--app-color-background-card': elevated,
    '--app-color-background-elevated': elevated, '--app-color-background-elevated-secondary': mix(ink, 4),
    '--app-color-background-editor-opaque': surface,
    '--color-background-control-opaque': elevated, '--app-color-background-control': elevated,
    '--color-background-composer-surface': elevated, '--color-background-composer-action-bar': elevated,
    '--color-background-execution-output': surface,
    '--color-token-main-surface-primary': surface, '--color-token-side-bar-background': 'var(--closure-sidebar)',
    '--app-color-background-application-menu': surface,
    '--color-text': ink, '--color-text-primary': ink, '--color-text-primary-surface': ink,
    '--color-text-primary-outline': ink, '--color-text-primary-ghost-hover': ink,
    '--app-color-text-primary': ink, '--app-color-text-foreground': ink,
    '--app-color-foreground-application-menu': ink,
    '--color-text-secondary': alpha(65), '--app-color-text-secondary': alpha(65),
    '--app-color-text-foreground-secondary': alpha(65), '--app-color-text-foreground-tertiary': alpha(47),
    '--color-text-tertiary': alpha(47), '--color-text-placeholder': alpha(47),
    '--color-border': alpha(10), '--app-color-border': alpha(10), '--color-border-strong': alpha(17),
    '--color-token-border-default': alpha(10), '--color-token-input-border': alpha(17),
    '--color-background-user-message': alpha(5), '--color-background-primary-soft': alpha(5),
    '--color-background-secondary-soft': alpha(5), '--color-background-primary-soft-hover': alpha(8),
    '--color-background-button-outline-hover': alpha(8),
    '--color-background-text-selection': `color-mix(in srgb, ${accent} 25%, transparent)`,
    '--color-accent': accent, '--color-text-accent': accent, '--color-button-accent': accent,
    '--color-background-accent': mix(accent, 15), '--color-background-accent-hover': mix(accent, 22),
    '--color-background-accent-active': mix(accent, 28),
    '--color-background-accent-solid': accent, '--color-background-accent-solid-hover': mix(accent, 80),
    '--color-background-accent-solid-active': mix(accent, 65),
    '--color-text-on-accent': 'var(--closure-sidebar)', '--color-token-on-accent': 'var(--closure-sidebar)',
    '--color-text-accent-solid': 'var(--closure-sidebar)', '--color-text-accent-action': '#ffffff',
    '--codex-theme-accent-color': accent, '--codex-theme-accent-text': accent,
    '--codex-theme-accent-icon': accent, '--codex-theme-accent-background-subtle': mix(accent, 15),
    '--codex-theme-accent-background-hover': mix(accent, 22),
    '--codex-theme-accent-background-pressed': mix(accent, 28),
    '--color-codex-terminal-background': surface, '--color-codex-terminal-foreground': ink,
    '--diffs-addition-color-override': semantic.diffAdded, '--diffs-deletion-color-override': semantic.diffRemoved,
    '--color-text-success': semantic.diffAdded, '--color-text-danger': semantic.diffRemoved,
    '--color-text-discovery': semantic.skill, '--color-icon-discovery': semantic.skill,
    '--font-ui-family': fonts.ui, '--font-code-family': fonts.code,
    '--codex-chat-font-family': fonts.content, '--codex-chat-code-font-family': fonts.code,
  }
  const declarations = Object.entries(values).map(([name, value]) => `${name}:${value} !important;`).join('\n')
  return { source, css: `html[data-closure-decoration="on"]{color-scheme:dark !important;${declarations}}` }
}

module.exports = { buildPalette }
