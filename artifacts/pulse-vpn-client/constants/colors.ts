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
    text: '#30384B',
    tint: '#5368E6',
    background: '#F2F4F8',
    foreground: '#30384B',
    card: '#FFFFFF',
    cardForeground: '#30384B',
    primary: '#5368E6',
    primaryForeground: '#FFFFFF',
    secondary: '#E9EDF5',
    secondaryForeground: '#38435C',
    muted: '#E9EDF5',
    mutedForeground: '#727D91',
    accent: '#E3F5F5',
    accentForeground: '#236F78',
    destructive: '#C64D54',
    destructiveForeground: '#FFFFFF',
    border: '#DCE2ED',
    input: '#D2DAE8',
    success: '#318B78',
    warning: '#B9783E',
    surfaceDeep: '#293A79',
    onDeep: '#F9FAFF',
  },
  dark: {
    text: '#E7EAF4',
    tint: '#9AA8FF',
    background: '#191D2B',
    foreground: '#E7EAF4',
    card: '#22283A',
    cardForeground: '#E7EAF4',
    primary: '#9AA8FF',
    primaryForeground: '#20284D',
    secondary: '#2B3247',
    secondaryForeground: '#D7DCEF',
    muted: '#2B3247',
    mutedForeground: '#A1A9BC',
    accent: '#263E49',
    accentForeground: '#A6E7E6',
    destructive: '#F28B91',
    destructiveForeground: '#351C22',
    border: '#363F57',
    input: '#46516B',
    success: '#78CBB7',
    warning: '#E4AD73',
    surfaceDeep: '#202C59',
    onDeep: '#F9FAFF',
  },

  // Border radius (in px). Sync from the sibling web artifact's --radius
  // CSS variable. This value applies to cards, buttons, inputs, and modals.
  radius: 16,
};

export default colors;
