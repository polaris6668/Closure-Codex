// These colours and mixes match outputs/closure-theme/closure-dark.txt and
// outputs/closure-decoration/palette.cjs. DSH's semantic names are mapped here.
export const PALETTE = Object.freeze({
  surface: '#0a0b16', ink: '#eef0ff', accent: '#ff3ea5',
  added: '#35e0d0', removed: '#ff2e63', violet: '#a678f0',
})

const { surface, ink, accent, added, removed, violet } = PALETTE
const mix = (colour, percent) => `color-mix(in srgb, ${surface}, ${colour} ${percent}%)`
const alpha = percent => `color-mix(in srgb, ${ink} ${percent}%, transparent)`
const tokens = {}
const set = (names, value) => names.split(/\s+/).filter(Boolean).forEach(name => { tokens[`--dsw-${name}`] = value })

set(`alias-bg-base specific-sidebar-fill alias-bg-document-preview`, surface)
set(`alias-bg-layer-1 alias-bg-layer-2 alias-markdown-code-block
  alias-markdown-code-block-banner specific-input-major specific-login-input
  alias-button-elevated-fill alias-button-floating-fill alias-card-fill
  alias-settings-card-fill alias-bg-module-platform alias-tooltip-bg alias-hovercard-bg`, mix(ink, 6))
set(`alias-bg-layer-3 alias-bg-overlay alias-button-floating-hover alias-card-fill-hover
  alias-interactive-bg-hover-solid alias-button-ghost-active-hover alias-tooltip-key-bg`, mix(ink, 10))
set(`specific-selector specific-tip alias-markdown-inline-code alias-markdown-tag
  alias-markdown-placeholder alias-markdown-citation alias-turn-trigger-bg`, mix(ink, 5))
set(`alias-bg-multi-select alias-button-ghost-active-fill specific-sidebar-nav-item-active
  specific-bubble alias-card-tile-fill alias-markdown-code-segment-unselected`, alpha(5))
set(`alias-interactive-bg-hover alias-turn-trigger-bg-hover`, alpha(8))
set(`alias-interactive-bg-active alias-interactive-bg-hover-accent`, alpha(12))
set(`alias-border-l1 alias-border-l2 alias-border-l2-darkmode-thin alias-border-inverted
  alias-border-inverted2`, alpha(10))
set(`alias-border-l3 alias-border-l4 alias-settings-card-stroke alias-button-ghost-active-border`, alpha(17))
set(`alias-border-selected`, accent)
set(`alias-label-primary alias-label-primary-bluish alias-label-primary-dimmed
  alias-brand-text alias-tooltip-label alias-toast-label alias-hovercard-label-primary
  alias-label-document-preview alias-json-tree-punctuation`, ink)
set(`alias-label-secondary alias-menu-icon alias-hovercard-label-secondary`, alpha(65))
set(`alias-label-tertiary alias-label-caption alias-hovercard-label-tertiary
  alias-json-tree-icon`, alpha(47))
set(`alias-label-dimmed alias-state-idle-primary alias-button-primary-dimmed`, alpha(28))
set(`alias-label-on-color`, '#ffffff')
set(`alias-label-primary-foreground alias-label-primary-inverted alias-brand-primary-invert`, surface)
set(`alias-brand-primary alias-brand-primary-new-colorprimary-new-color alias-state-business-primary
  alias-button-primary-fill alias-button-info-fill alias-link alias-toast-action
  specific-sidebar-right-flash alias-trajectory-accent`, accent)
set(`alias-button-primary-hover alias-button-info-hover`, mix(accent, 80))
set(`alias-state-business-tertiary specific-sidebar-nav-item-active-accent
  specific-bubble-highlight alias-markdown-code-segment-selected`, mix(accent, 15))
set(`alias-bg-document-selection`, `color-mix(in srgb, ${accent} 25%, transparent)`)
set(`alias-state-success-primary alias-state-success-secondary alias-file-diff-added-marker`, added)
set(`alias-state-success-tertiary alias-code-diff-added alias-file-diff-added-bg`, mix(added, 12))
set(`alias-file-diff-added-gutter`, mix(added, 7))
set(`alias-state-error-primary alias-state-error-secondary alias-file-diff-deleted-marker
  alias-hovercard-state-error`, removed)
set(`alias-interactive-bg-hover-danger alias-code-diff-deleted alias-file-diff-deleted-bg`, mix(removed, 12))
set(`alias-file-diff-deleted-gutter`, mix(removed, 7))
set(`alias-state-done-primary alias-hovercard-state-done alias-chart-tools
  alias-json-tree-keyword alias-json-tree-number`, violet)
set(`alias-label-deep-diving alias-chart-messages`, mix(accent, 75))
set(`alias-label-deep-diving-shimmer alias-label-shimmer`, alpha(75))
set(`alias-chart-system`, alpha(47))
set(`alias-scrollbar-bg-l1 alias-scrollbar-bg-l2`, alpha(17))
set(`alias-scrollbar-hover-l1 alias-scrollbar-hover-l2 alias-switch-thumb`, alpha(32))
set(`alias-json-tree-hover`, alpha(5))
set(`alias-json-tree-property`, violet)
set(`alias-json-tree-string`, added)
set(`alias-toast-bg`, mix(ink, 10))
set(`menu-surface-fill specific-menu alias-menu-group-header-fill`, mix(ink, 6))
set(`alias-illustration-background`, surface)
set(`alias-illustration-backing alias-illustration-shadow`, mix(ink, 8))
set(`alias-illustration-detail alias-illustration-inset`, mix(violet, 18))
set(`alias-illustration-surface`, mix(violet, 25))

export const TOKENS = Object.freeze(tokens)
