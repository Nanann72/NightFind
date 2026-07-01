/**
 * Babel configuration for Night Finder (Expo SDK 54).
 *
 * IMPORTANT: This file is REQUIRED for EAS/TestFlight native builds.
 * Without it, Metro falls back to a minimal preset that does NOT include
 * `babel-preset-expo`. Result: React Native Reanimated worklets fail to
 * transform, and the iOS binary crashes on boot with a red screen
 * (typical error: "Reanimated 3 failed to create a worklet, maybe you
 * forgot to add Reanimated's babel plugin?"). Web preview and Expo Go
 * still work because they use different bundler configs — this is why
 * the bug is invisible in development but fatal in TestFlight.
 *
 * `babel-preset-expo` already ships with the reanimated worklet plugin
 * for SDK 54, so we don't need to add it manually.
 */
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
  };
};
