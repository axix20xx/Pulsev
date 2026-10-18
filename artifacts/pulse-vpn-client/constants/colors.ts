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
    text: '#203832',
    tint: '#197767',
    background: '#F3F5F0',
    foreground: '#203832',
    card: '#FBFCF8',
    cardForeground: '#203832',
    primary: '#197767',
    primaryForeground: '#F7FAF6',
    secondary: '#E6EDE6',
    secondaryForeground: '#294A40',
    muted: '#E9EEE8',
    mutedForeground: '#74847B',
    accent: '#DCE9DF',
    accentForeground: '#24594B',
    destructive: '#A54F4A',
    destructiveForeground: '#FFFFFF',
    border: '#DCE4DB',
    input: '#D2DDD3',
    success: '#347B63',
    warning: '#A87337',
    surfaceDeep: '#173C35',
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
