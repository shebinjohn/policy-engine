/**
 * Color tokens of the Safe Research design system (docs/design-system/tokens.json), as the UI uses
 * them. scripts/build.mjs turns these into the :root blocks of the page: LIGHT on bare :root, DARK
 * under prefers-color-scheme (unless data-theme="light") and again under [data-theme="dark"].
 *
 * Page mapping (Safe{Wallet} style): body sits on `surface`, cards are `surface-raised`, inputs and
 * code wells use `ground`.
 */
export const LIGHT = {
  ground: '#FFFFFF',
  surface: '#F4F4F4',
  'surface-raised': '#FFFFFF',
  node: '#EEEEEE',
  'node-edge': '#636669',
  plate: '#121312',
  'on-plate': '#FFFFFF',
  ink: '#121312',
  'ink-muted': '#636669',
  heading: '#121312',
  link: '#0D7F42',
  'on-brand': '#121312',
  'on-node': '#121312',
  brand: '#12FF80',
  'brand-pressed': '#0FDA6D',
  'brand-deep': '#0D7F42',
  'brand-light': '#B0FFC9',
  'brand-tint': '#EFFFF4',
  icon: '#0D7F42',
  connector: '#121312',
  focus: '#0D7F42',
  rule: '#DCDEE0',
  line: '#DCDEE0',
  'line-strong': '#636669',
  ornament: '#DDDEE0',
  lime: '#EEFF41',
  mint: '#BAF1D2',
  danger: '#8A1C27',
  'danger-bg': '#FFE0E6',
  warning: '#6C2D19',
  'warning-bg': '#FFECC2',
  info: '#15566A',
  'info-bg': '#CEF0FD',
  success: '#1C5538',
  'success-bg': '#CBF2DB'
}

export const DARK = {
  ...LIGHT,
  ground: '#000000',
  surface: '#121312',
  'surface-raised': '#1C1C1C',
  'node-edge': '#EEEEEE',
  plate: '#000000',
  ink: '#FFFFFF',
  'ink-muted': '#A1A3A7',
  heading: '#12FF80',
  link: '#12FF80',
  'on-brand': '#000000',
  'on-node': '#000000',
  'brand-pressed': '#0CB259',
  'brand-tint': '#1B2A22',
  icon: '#12FF80',
  connector: '#FFFFFF',
  focus: '#12FF80',
  rule: '#CCCCCC',
  line: '#303033',
  ornament: '#3C3C3C',
  danger: '#FF5F72',
  'danger-bg': '#4A2125',
  warning: '#FF8061',
  'warning-bg': '#4A3621',
  info: '#5FDDFF',
  'info-bg': '#203339',
  success: '#00B460',
  'success-bg': '#173026'
}

/** Theme-independent tokens. */
export const STATIC = {
  'font-sans': '"DM Sans", system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  'font-mono': '"Geist Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
  'radius-sm': '4px',
  'radius-md': '6px',
  'radius-lg': '8px',
  'radius-xl': '12px',
  'radius-node': '26px',
  'space-1': '8px',
  'space-2': '16px',
  'space-3': '24px',
  'space-4': '32px',
  'space-5': '40px',
  'space-6': '48px',
  'space-8': '64px',
  'stroke-connector': '1.4px',
  'stroke-focus': '2px'
}
