module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      // react-native-worklets/plugin is REQUIRED for react-native-reanimated 4.x
      // (the legacy 'react-native-reanimated/plugin' is just a wrapper).
      // Without it, worklets crash silently on iOS native release builds
      // → black screen on TestFlight / App Store builds.
      // MUST be listed last (Babel processes plugins in order).
      'react-native-worklets/plugin',
    ],
  };
};
