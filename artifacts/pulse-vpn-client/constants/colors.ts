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
    text: '#263B3A',
    tint: '#176F69',
    background: '#F4F7F1',
    foreground: '#263B3A',
    card: '#FFFEFA',
    cardForeground: '#263B3A',
    primary: '#176F69',
    primaryForeground: '#F7FFFA',
    secondary: '#E6EEE7',
    secondaryForeground: '#34504A',
    muted: '#E8EFE9',
    mutedForeground: '#71837B',
    accent: '#D5EFE1',
    accentForeground: '#25564B',
    destructive: '#B64F4A',
    destructiveForeground: '#FFF9F5',
    border: '#DCE6DD',
    input: '#CFDCD2',
    success: '#327C65',
    warning: '#AA7741',
    surfaceDeep: '#174D49',
    onDeep: '#F7FFF9',
  },
  dark: {
    text: '#E4F0E8',
    tint: '#86D0B0',
    background: '#14231F',
    foreground: '#E4F0E8',
    card: '#1D302A',
    cardForeground: '#E4F0E8',
    primary: '#86D0B0',
    primaryForeground: '#19382F',
    secondary: '#293C35',
    secondaryForeground: '#D5E7DC',
    muted: '#293C35',
    mutedForeground: '#9AAFA3',
    accent: '#294D40',
    accentForeground: '#BFE7D1',
    destructive: '#E38A7E',
    destructiveForeground: '#351C19',
    border: '#354B41',
    input: '#486055',
    success: '#7CC8A5',
    warning: '#D4A968',
    surfaceDeep: '#153C35',
    onDeep: '#F7FFF9',
  },

  // Border radius (in px). Sync from the sibling web artifact's --radius
  // CSS variable. This value applies to cards, buttons, inputs, and modals.
  radius: 24,
};

export default colors;
