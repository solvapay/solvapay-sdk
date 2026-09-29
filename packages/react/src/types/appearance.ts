/**
 * The SDK's own card-form appearance.
 *
 * Themes the vault `CardFields` (VGS Collect hosted inputs). `variables`
 * carry colours, font, radius and base size; `rules` override the input
 * states by selector; `fonts` become `@font-face` inside the hosted
 * iframes (they cannot see host fonts). See `buildCollectFieldCss` for how
 * each entry lands in the field CSS.
 */
export interface AppearanceVariables {
  colorText?: string
  colorTextSecondary?: string
  colorTextPlaceholder?: string
  colorBackground?: string
  colorBorder?: string
  colorPrimary?: string
  colorDanger?: string
  borderRadius?: string
  fontFamily?: string
  fontSizeBase?: string
  fontLineHeight?: string
}

/** CSS declarations (camelCase properties) for one input state. */
export type AppearanceRule = Record<string, string>

export interface AppearanceRules {
  '.Input'?: AppearanceRule
  '.Input:focus'?: AppearanceRule
  '.Input--invalid'?: AppearanceRule
  '.Input::placeholder'?: AppearanceRule
}

/** A font the hosted fields load themselves (`src` is a CSS `src` value, e.g. `url(...)`). */
export interface AppearanceFont {
  family: string
  src: string
  weight?: string
  style?: string
  display?: string
}

export interface Appearance {
  variables?: AppearanceVariables
  rules?: AppearanceRules
  fonts?: AppearanceFont[]
}
