/**
 * Night Finder Design System v2 — iOS 26 inspired
 * --------------------------------------------------
 * Premium native-feeling tokens following Apple HIG.
 * Supports dark & light modes, dynamic type, 8pt grid,
 * SF Pro typography (native iOS) + Inter fallback.
 *
 * Backward compatible: legacy `colors`, `spacing`,
 * `radius`, `fonts` exports still work for existing code.
 * New code should use `useThemeColors()` from themeContext.
 */
import { Platform } from 'react-native';

// ─────────────────────────────────────────────────────────
// PALETTE — Brand + neutrals (consistent across themes)
// ─────────────────────────────────────────────────────────

const brand = {
  primary: '#E01A4F',
  primaryHover: '#F0285F',
  primaryPressed: '#C8163F',
  primarySoft: 'rgba(224, 26, 79, 0.14)',
  secondary: '#F2C94C',
  tertiary: '#00F0FF',
  success: '#34C759',
  warning: '#FF9F0A',
  danger: '#FF3B30',
  info: '#0A84FF',
};

// ─────────────────────────────────────────────────────────
// DARK THEME — Default night-mode palette
// ─────────────────────────────────────────────────────────

export const darkColors = {
  bg: '#000000',
  surface: '#0C0C0F',
  surfaceElevated: '#1C1C1F',
  surfaceHigher: '#2C2C2F',
  glass: 'rgba(20, 20, 22, 0.72)',
  glassStrong: 'rgba(20, 20, 22, 0.92)',
  glassThin: 'rgba(20, 20, 22, 0.42)',
  textPrimary: '#FFFFFF',
  textSecondary: '#9E9EA7',
  textTertiary: '#56565E',
  textQuaternary: '#3A3A40',
  border: 'rgba(255, 255, 255, 0.08)',
  borderStrong: 'rgba(255, 255, 255, 0.16)',
  borderSubtle: 'rgba(255, 255, 255, 0.04)',
  fill: 'rgba(120, 120, 128, 0.16)',
  fillStrong: 'rgba(120, 120, 128, 0.24)',
  fillSubtle: 'rgba(120, 120, 128, 0.08)',
  ...brand,
  tabBarBg: 'rgba(16, 16, 18, 0.78)',
  tabBarBorder: 'rgba(255, 255, 255, 0.08)',
  statusBarStyle: 'light' as const,
};

// ─────────────────────────────────────────────────────────
// LIGHT THEME — Day-mode palette (Apple-style)
// ─────────────────────────────────────────────────────────

export const lightColors = {
  bg: '#FFFFFF',
  surface: '#F2F2F7',
  surfaceElevated: '#FFFFFF',
  surfaceHigher: '#FFFFFF',
  glass: 'rgba(255, 255, 255, 0.78)',
  glassStrong: 'rgba(255, 255, 255, 0.95)',
  glassThin: 'rgba(255, 255, 255, 0.55)',
  textPrimary: '#000000',
  textSecondary: '#3C3C43',
  textTertiary: '#8E8E93',
  textQuaternary: '#C7C7CC',
  border: 'rgba(60, 60, 67, 0.12)',
  borderStrong: 'rgba(60, 60, 67, 0.24)',
  borderSubtle: 'rgba(60, 60, 67, 0.06)',
  fill: 'rgba(120, 120, 128, 0.16)',
  fillStrong: 'rgba(120, 120, 128, 0.24)',
  fillSubtle: 'rgba(120, 120, 128, 0.08)',
  ...brand,
  tabBarBg: 'rgba(255, 255, 255, 0.82)',
  tabBarBorder: 'rgba(60, 60, 67, 0.18)',
  statusBarStyle: 'dark' as const,
};

export type ThemeColors = typeof darkColors;

// LEGACY EXPORT — keeps existing screens working unchanged
export const colors = darkColors;

// ─────────────────────────────────────────────────────────
// SPACING — Strict 8pt grid
// ─────────────────────────────────────────────────────────

export const spacing = {
  none: 0,
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
  xxxl: 64,
} as const;

// ─────────────────────────────────────────────────────────
// RADII — Apple HIG-compliant
// ─────────────────────────────────────────────────────────

export const radius = {
  none: 0,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 22,
  xxl: 28,
  pill: 999,
  full: 999,
} as const;

// ─────────────────────────────────────────────────────────
// SHADOWS — Native-style elevation
// ─────────────────────────────────────────────────────────

export const shadows = {
  none: { shadowColor: 'transparent', shadowOpacity: 0, shadowRadius: 0, shadowOffset: { width: 0, height: 0 }, elevation: 0 },
  xs: { shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  sm: { shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  md: { shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 14, shadowOffset: { width: 0, height: 4 }, elevation: 4 },
  lg: { shadowColor: '#000', shadowOpacity: 0.14, shadowRadius: 22, shadowOffset: { width: 0, height: 8 }, elevation: 8 },
  xl: { shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 32, shadowOffset: { width: 0, height: 12 }, elevation: 16 },
  primaryGlow: { shadowColor: brand.primary, shadowOpacity: 0.5, shadowRadius: 22, shadowOffset: { width: 0, height: 8 }, elevation: 10 },
} as const;

// ─────────────────────────────────────────────────────────
// TYPOGRAPHY — SF Pro (iOS) / Inter (other platforms)
// ─────────────────────────────────────────────────────────

const fontFamilies = Platform.select({
  ios: { sans: 'System', sansRounded: 'System', mono: 'Menlo' },
  android: { sans: 'sans-serif', sansRounded: 'sans-serif-medium', mono: 'monospace' },
  default: { sans: 'Inter', sansRounded: 'Inter', mono: 'ui-monospace, Menlo, monospace' },
})!;

export const typography = {
  largeTitle: { fontFamily: fontFamilies.sans, fontSize: 34, lineHeight: 41, fontWeight: '700' as const, letterSpacing: 0.37 },
  title1: { fontFamily: fontFamilies.sans, fontSize: 28, lineHeight: 34, fontWeight: '700' as const, letterSpacing: 0.36 },
  title2: { fontFamily: fontFamilies.sans, fontSize: 22, lineHeight: 28, fontWeight: '700' as const, letterSpacing: 0.35 },
  title3: { fontFamily: fontFamilies.sans, fontSize: 20, lineHeight: 25, fontWeight: '600' as const, letterSpacing: 0.38 },
  headline: { fontFamily: fontFamilies.sans, fontSize: 17, lineHeight: 22, fontWeight: '600' as const, letterSpacing: -0.41 },
  body: { fontFamily: fontFamilies.sans, fontSize: 17, lineHeight: 22, fontWeight: '400' as const, letterSpacing: -0.41 },
  bodyMedium: { fontFamily: fontFamilies.sans, fontSize: 17, lineHeight: 22, fontWeight: '500' as const, letterSpacing: -0.41 },
  callout: { fontFamily: fontFamilies.sans, fontSize: 16, lineHeight: 21, fontWeight: '400' as const, letterSpacing: -0.32 },
  subhead: { fontFamily: fontFamilies.sans, fontSize: 15, lineHeight: 20, fontWeight: '400' as const, letterSpacing: -0.24 },
  subheadMedium: { fontFamily: fontFamilies.sans, fontSize: 15, lineHeight: 20, fontWeight: '600' as const, letterSpacing: -0.24 },
  footnote: { fontFamily: fontFamilies.sans, fontSize: 13, lineHeight: 18, fontWeight: '400' as const, letterSpacing: -0.08 },
  caption1: { fontFamily: fontFamilies.sans, fontSize: 12, lineHeight: 16, fontWeight: '400' as const, letterSpacing: 0 },
  caption1Medium: { fontFamily: fontFamilies.sans, fontSize: 12, lineHeight: 16, fontWeight: '600' as const, letterSpacing: 0 },
  caption2: { fontFamily: fontFamilies.sans, fontSize: 11, lineHeight: 13, fontWeight: '400' as const, letterSpacing: 0.07 },
  eyebrow: { fontFamily: fontFamilies.sans, fontSize: 12, lineHeight: 16, fontWeight: '700' as const, letterSpacing: 1.6, textTransform: 'uppercase' as const },
} as const;

export const fonts = {
  heading: fontFamilies.sans,
  headingExtra: fontFamilies.sans,
  body: fontFamilies.sans,
  bodyMedium: fontFamilies.sans,
  bodyBold: fontFamilies.sans,
};

// ─────────────────────────────────────────────────────────
// MOTION — Spring presets (ProMotion 120Hz ready)
// ─────────────────────────────────────────────────────────

export const motion = {
  spring: {
    snappy: { damping: 18, mass: 0.6, stiffness: 320 },
    smooth: { damping: 20, mass: 1, stiffness: 200 },
    bouncy: { damping: 12, mass: 0.9, stiffness: 180 },
    gentle: { damping: 24, mass: 1, stiffness: 140 },
    sheet: { damping: 26, mass: 1, stiffness: 280 },
  },
  duration: { instant: 100, quick: 180, standard: 250, smooth: 320, slow: 480 },
} as const;

// ─────────────────────────────────────────────────────────
// GRADIENTS
// ─────────────────────────────────────────────────────────

export const gradients = {
  primary: ['#E01A4F', '#F2295F'] as const,
  primarySunset: ['#E01A4F', '#F2C94C'] as const,
  cyanGlow: ['#00F0FF', '#0A84FF'] as const,
  darkOverlay: ['rgba(0,0,0,0)', 'rgba(0,0,0,0.85)'] as const,
  darkOverlayStrong: ['rgba(0,0,0,0)', 'rgba(0,0,0,0.95)'] as const,
  topFade: ['rgba(0,0,0,0.55)', 'rgba(0,0,0,0)'] as const,
};

export const hitSlop = {
  small: { top: 8, bottom: 8, left: 8, right: 8 },
  medium: { top: 12, bottom: 12, left: 12, right: 12 },
  large: { top: 16, bottom: 16, left: 16, right: 16 },
};

export const layer = {
  base: 0,
  card: 1,
  sticky: 5,
  tabBar: 10,
  modal: 100,
  sheet: 200,
  toast: 500,
  overlay: 1000,
};
