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
    text: '#17253A',
    tint: '#00AFCB',
    background: '#EEF4F7',
    foreground: '#17253A',
    card: '#F9FCFD',
    cardForeground: '#17253A',
    primary: '#00AFCB',
    primaryForeground: '#06212B',
    secondary: '#DFEAF0',
    secondaryForeground: '#23465A',
    muted: '#E2EBF0',
    mutedForeground: '#607687',
    accent: '#D8F5F8',
    accentForeground: '#126075',
    destructive: '#C64E60',
    destructiveForeground: '#FFF8F8',
    border: '#D1E0E8',
    input: '#B8CBD6',
    success: '#238C82',
    warning: '#B97836',
    surfaceDeep: '#10273A',
  },
  dark: {
    text: '#EAF4F8',
    tint: '#46D8EF',
    background: '#081522',
    foreground: '#EAF4F8',
    card: '#102235',
    cardForeground: '#EAF4F8',
    primary: '#46D8EF',
    primaryForeground: '#06212B',
    secondary: '#182D40',
    secondaryForeground: '#D8E8F0',
    muted: '#1A3044',
    mutedForeground: '#91A8B9',
    accent: '#153B4B',
    accentForeground: '#8CE7F2',
    destructive: '#E67A86',
    destructiveForeground: '#2B1118',
    border: '#254056',
    input: '#355268',
    success: '#59C7B2',
    warning: '#E4B267',
    surfaceDeep: '#091A29',
  },

  // Border radius (in px). Sync from the sibling web artifact's --radius
  // CSS variable. This value applies to cards, buttons, inputs, and modals.
  radius: 20,
};

export default colors;
