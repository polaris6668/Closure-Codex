// WorkBuddy desktop's wb/cb/VS Code semantic variables, inspected in 5.11.3.
// Keep native layout and type sizes; only colours and font families are mapped.
export const PALETTE = Object.freeze({
  surface:'#0a0b16',ink:'#eef0ff',accent:'#ff3ea5',added:'#35e0d0',removed:'#ff2e63',violet:'#a678f0',
})
const {surface,ink,accent,added,removed,violet}=PALETTE
const mix=(color,percent)=>`color-mix(in srgb, ${surface}, ${color} ${percent}%)`
const alpha=percent=>`rgb(238 240 255 / ${percent}%)`
const tokens={}
const set=(names,value)=>names.split(/\s+/).filter(Boolean).forEach(name=>{tokens[`--${name}`]=value})
set(`wb-color-bg-primary-default wb-bg-primary wb-home-bg-primary wb-bg-content wb-sidebar-bg
  cb-bg-primary cb-bg-primary-default cb-sidebar-bg cb-sidebar-background
  vscode-editor-background vscode-sideBar-background vscode-titleBar-activeBackground vscode-titleBar-inactiveBackground`,surface)
set(`wb-color-bg-secondary-default wb-bg-secondary wb-bg-tertiary wb-bg-card wb-bg-elevated wb-bg-input-inset
  wb-home-bg-secondary wb-home-input-slot-bg wb-bg-modal wb-bg-popover wb-bg-tooltip wb-bg-popover-picker
  wb-color-bg-card-default wb-recommend-prompt-bg wb-bg-input-slot-gradient
  cb-bg-secondary cb-bg-tertiary cb-bg-card cb-bg-elevated cb-bg-surface cb-input-background cb-input-area-container-secondary
  vscode-input-background vscode-menu-background vscode-dropdown-background vscode-editorWidget-background
  vscode-editorHoverWidget-background vscode-panel-background vscode-notifications-background`,mix(ink,6))
set(`wb-bg-card-strong wb-bg-overlay-elevated wb-bg-inset-strong wb-color-bg-card-hover
  wb-bg-card-hover wb-bg-active-hover cb-bg-surface-active vscode-list-activeSelectionBackground`,mix(ink,10))
set(`wb-color-bg-primary-hover wb-color-bg-primary-active wb-color-bg-secondary-hover-active wb-bg-hover
  wb-bg-hover-light wb-bg-hover-subtle wb-todo-menu-bg-hover wb-home-composer-chip-bg-hover
  wb-bg-pill-hover cb-bg-primary-hover cb-bg-primary-active cb-sidebar-surface-hover
  cb-sidebar-item-hover-background cb-panel-bg-hover cb-bg-surface-hover cb-input-hover-bg
  vscode-list-hoverBackground vscode-toolbar-hoverBackground`,alpha(8))
set(`wb-bg-hover-strong wb-bg-active wb-bg-item-selected wb-bg-row-selected wb-todo-menu-bg-active
  wb-control-selected-bg wb-bg-pill-active cb-sidebar-active vscode-menu-selectionBackground`,alpha(14))
set(`wb-color-text-primary wb-color-text-solid wb-text-strong wb-text-white wb-text-on-inverse
  wb-todo-menu-text-default wb-todo-menu-text-heading wb-input-color-text wb-input-color-icon
  cb-text-primary cb-text-solid cb-text-primary-strong cb-input-foreground cb-sidebar-text
  vscode-foreground vscode-editor-foreground vscode-input-foreground vscode-menu-foreground
  vscode-titleBar-activeForeground vscode-titleBar-inactiveForeground vscode-sideBar-foreground
  cb-vscode-titleBar-activeForeground cb-vscode-titleBar-inactiveForeground`,ink)
set(`wb-color-text-secondary wb-color-text-secondary-solid wb-text-medium wb-text-connector
  wb-input-color-icon-hover wb-todo-menu-text-view-more cb-text-secondary cb-text-secondary-strong cb-sidebar-text-secondary
  vscode-descriptionForeground vscode-icon-foreground`,alpha(76))
set(`wb-color-text-tertiary wb-color-text-placeholder wb-color-text-hint wb-text-weak wb-text-muted
  wb-text-placeholder-soft wb-input-color-placeholder wb-textarea-color-placeholder
  cb-text-tertiary cb-text-quaternary cb-text-placeholder cb-text-muted cb-input-placeholder cb-sidebar-text-muted
  vscode-input-placeholderForeground`,alpha(55))
set(`wb-color-text-disabled wb-text-disable wb-input-color-text-disabled wb-input-color-icon-disabled
  cb-text-disabled vscode-disabledForeground`,alpha(30))
set(`wb-color-border-primary wb-color-border-secondary wb-color-border-tertiary wb-border-default
  wb-border-weak wb-border-subtle wb-border-faint wb-border-card wb-border-card-static wb-border-control
  wb-border-teams wb-sidebar-border wb-border-input wb-recommend-prompt-border wb-border-popover
  wb-input-border-color cb-border cb-border-default cb-border-subtle cb-border-secondary cb-input-border-color
  vscode-panel-border vscode-editorWidget-border vscode-menu-border vscode-input-border`,alpha(14))
set(`wb-border-strong wb-border-hover wb-input-border-color-hover cb-border-strong cb-border-bright`,alpha(22))
set(`wb-color-accent-brand wb-color-border-focus wb-border-focus wb-border-selected wb-border-action
  wb-color-text-brand-default wb-color-text-brand-hover wb-color-text-brand-focus wb-color-text-brand-active
  wb-color-text-link-default wb-color-text-link-hover wb-brand-primary wb-brand-accent wb-brand-bright
  wb-text-link wb-text-link-brand wb-text-link-default wb-text-action wb-input-brand-caret-color
  wb-input-border-color-focus cb-accent cb-text-link cb-text-link-hover cb-input-active-border
  cb-input-focus-border-color vscode-focusBorder vscode-textLink-foreground vscode-textLink-activeForeground
  vscode-button-background vscode-progressBar-background vscode-list-highlightForeground`,accent)
set(`wb-text-on-primary wb-text-inverse wb-bg-inverse cb-input-button-foreground vscode-button-foreground`,surface)
set(`wb-brand-primary-deep cb-accent-hover vscode-button-hoverBackground`,mix(accent,80))
set(`wb-brand-primary-subtle wb-brand-accent-bg wb-brand-soft wb-bg-focus-soft
  wb-input-brand-selection-bg vscode-editor-selectionBackground`,mix(accent,25))
set(`wb-color-text-success-default wb-color-text-success-hover wb-color-text-success-active
  wb-text-success wb-status-success vscode-gitDecoration-addedResourceForeground vscode-editorGutter-addedBackground`,added)
set(`wb-color-text-error-default wb-color-text-error-hover wb-color-text-error-active wb-status-error
  wb-text-danger cb-text-error-active vscode-errorForeground vscode-gitDecoration-deletedResourceForeground
  vscode-editorGutter-deletedBackground`,removed)
set(`wb-bg-success-soft wb-bg-success-soft-dark vscode-diffEditor-insertedTextBackground`,mix(added,12))
set(`wb-bg-error-soft wb-bg-error-subtle wb-bg-error-hover vscode-diffEditor-removedTextBackground`,mix(removed,12))
set(`wb-accent-purple wb-accent-violet wb-accent-purple-light vscode-gitDecoration-modifiedResourceForeground`,violet)
set(`wb-bg-purple wb-bg-purple-soft wb-bg-purple-light`,mix(violet,12))
set(`wb-scrollbar-thumb-bg wb-textarea-scrollbar-thumb-color vscode-scrollbarSlider-background`,alpha(17))
set(`vscode-scrollbarSlider-hoverBackground vscode-scrollbarSlider-activeBackground`,alpha(32))
set(`wb-color-mask-color wb-bg-overlay wb-bg-overlay-on-dark`, 'rgb(8 8 16 / 65%)')
set(`cr-internal-bg-canvas cr-internal-bg-primary cr-internal-bg-primary-default
  cr-internal-message-list-bottom-mask-bg`,surface)
set(`cr-internal-bg-secondary cr-internal-bg-tertiary cr-internal-bg-neutral-inset cr-internal-bg-elevated
  cr-internal-bg-code cr-internal-bg-code-header cr-internal-bg-input-inset cr-internal-bg-input-slot-gradient
  cr-internal-popover-bg cr-internal-tooltip-bg cr-internal-bg-code-inline cr-internal-tag-bg`,mix(ink,6))
set(`cr-internal-text-primary cr-internal-icon-primary cr-internal-tooltip-text-color cr-internal-scene-tag-fg`,ink)
set(`cr-internal-text-secondary`,alpha(76))
set(`cr-internal-text-tertiary cr-internal-text-surplus cr-internal-text-placeholder-from cr-internal-text-placeholder-to`,alpha(55))
set(`cr-internal-text-disabled cr-internal-icon-disabled`,alpha(30))
set(`cr-internal-border-default cr-internal-border-primary cr-internal-border-faint cr-internal-popover-border
  cr-internal-popover-divider cr-internal-border-elevated cr-internal-input-shell-border-from cr-internal-input-shell-border-to`,alpha(14))
set(`cr-internal-brand-primary cr-internal-accent cr-internal-accent-secondary cr-internal-focus-border
  cr-internal-send-button-fill cr-internal-text-link cr-internal-text-link-hover`,accent)
set(`cr-internal-color-on-accent cr-internal-control-selected-fg`,surface)
set(`cr-internal-bg-hover cr-internal-item-hover-bg cr-internal-item-self-hover-bg cr-internal-scene-tag-bg
  cr-internal-chip-hover-bg`,alpha(8))
set(`cr-internal-item-selected-bg cr-internal-control-selected-bg cr-internal-scene-tag-bg-hover cr-internal-scene-tag-bg-active`,alpha(14))
set(`cr-internal-text-success cr-internal-status-success`,added)
set(`cr-internal-text-error cr-internal-text-error-default cr-internal-status-error cr-internal-permission-danger`,removed)
set(`cr-internal-scrollbar-thumb`,alpha(17))
set(`cr-internal-scrollbar-thumb-hover`,alpha(32))
set(`cr-internal-send-button-fill-disabled`,mix(accent,30))
const font='"Cascadia Mono", "DengXian", "等线", "Microsoft YaHei UI", "Microsoft YaHei", ui-monospace, monospace'
set(`vscode-font-family cb-font-family wb-font-family cr-internal-font-family cr-font-family`,font)
set(`vscode-editor-font-family font-mono cr-internal-font-mono cr-font-mono`,'"Cascadia Mono", Consolas, "DengXian", "等线", "Microsoft YaHei UI", monospace')
export const TOKENS=Object.freeze(tokens)
export const FONT=font
