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
    text: '#2C3448',
    tint: '#526CE5',
    background: '#F2F5F8',
    foreground: '#2C3448',
    card: '#FFFFFF',
    cardForeground: '#2C3448',
    primary: '#526CE5',
    primaryForeground: '#FFFFFF',
    secondary: '#E8EDF3',
    secondaryForeground: '#2C3448',
    muted: '#E8EDF3',
    mutedForeground: '#7B8292',
    accent: '#BDECEF',
    accentForeground: '#183E4A',
    destructive: '#CC4D48',
    destructiveForeground: '#FFFFFF',
    border: '#D8DEE8',
    input: '#D8DEE8',
    success: '#21836E',
    warning: '#A86C25',
    surfaceDeep: '#15263E',
    onDeep: '#FFFFFF',
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
    onDeep: '#FFFFFF',
  },

  // Border radius (in px). Sync from the sibling web artifact's --radius
  // CSS variable. This value applies to cards, buttons, inputs, and modals.
  radius: 20,
};

export default colors;
