/**
 * Semantic design tokens for the mobile app.
 *
 * These tokens mirror the naming conventions used in web artifacts (index.css)
 * so that multi-artifact projects share a cohesive visual identity.
 *
 * Replace the placeholder values below with values that match the project's
 * brand. If a sibling web artifact exists, read its index.css and convert the
 * HSL values to hex so both artifacts use the same palette.
 *
 * To add dark mode, add a `dark` key with the same token names.
 * The useColors() hook will automatically pick it up.
 */

const colors = {
  light: {
    text: '#18313B',
    tint: '#12675D',
    background: '#F2F7F5',
    foreground: '#18313B',
    card: '#FBFDFC',
    cardForeground: '#18313B',
    primary: '#14695F',
    primaryForeground: '#F7FCF9',
    secondary: '#E5EFEB',
    secondaryForeground: '#33534D',
    muted: '#E8F0ED',
    mutedForeground: '#657B75',
    accent: '#DCEFE8',
    accentForeground: '#145E53',
    destructive: '#B34E52',
    destructiveForeground: '#FFF9F7',
    border: '#D5E3DD',
    input: '#C7D8D0',
    success: '#287A60',
    warning: '#A96A32',
    surfaceDeep: '#183C47',
    onDeep: '#F4FAF7',
  },
  dark: {
    text: '#E3EEE9',
    tint: '#8AC8B0',
    background: '#15262C',
    foreground: '#E3EEE9',
    card: '#1D3239',
    cardForeground: '#E3EEE9',
    primary: '#82C4A8',
    primaryForeground: '#15372F',
    secondary: '#294047',
    secondaryForeground: '#D4E7DF',
    muted: '#294047',
    mutedForeground: '#A2B9B0',
    accent: '#294C46',
    accentForeground: '#B5E4CF',
    destructive: '#E58D8B',
    destructiveForeground: '#381F22',
    border: '#385159',
    input: '#49646A',
    success: '#82C9A8',
    warning: '#E5B477',
    surfaceDeep: '#173B45',
    onDeep: '#F4FAF7',
  },

  // Border radius (in px). Sync from the sibling web artifact's --radius
  // CSS variable. This value applies to cards, buttons, inputs, and modals.
  radius: 16,
};

export default colors;
