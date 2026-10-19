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
    text: '#2D3649',
    tint: '#3C5EE7',
    background: '#F1F4F8',
    foreground: '#2D3649',
    card: '#FFFFFF',
    cardForeground: '#2D3649',
    primary: '#3C5EE7',
    primaryForeground: '#FFFFFF',
    secondary: '#EBF1FF',
    secondaryForeground: '#2647C9',
    muted: '#E8EDF4',
    mutedForeground: '#7A8494',
    accent: '#DDF5F6',
    accentForeground: '#1C5864',
    destructive: '#CC392E',
    destructiveForeground: '#FFFFFF',
    border: '#DFE4EC',
    input: '#D6DDE8',
    success: '#3C9F79',
    warning: '#E29B36',
    surfaceDeep: '#2647C9',
  },
  dark: {
    text: '#E4EEE7',
    tint: '#78B9A3',
    background: '#14251F',
    foreground: '#E4EEE7',
    card: '#1C3029',
    cardForeground: '#E4EEE7',
    primary: '#78B9A3',
    primaryForeground: '#10251E',
    secondary: '#283D34',
    secondaryForeground: '#D3E2D8',
    muted: '#263A32',
    mutedForeground: '#9BAFA3',
    accent: '#29483B',
    accentForeground: '#B6D7C4',
    destructive: '#D98276',
    destructiveForeground: '#241513',
    border: '#33483D',
    input: '#40564A',
    success: '#87C5A1',
    warning: '#D2A66E',
    surfaceDeep: '#10221C',
  },

  // Border radius (in px). Sync from the sibling web artifact's --radius
  // CSS variable. This value applies to cards, buttons, inputs, and modals.
  radius: 20,
};

export default colors;
