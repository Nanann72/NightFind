module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      // react-native-reanimated/plugin MUST be listed last.
      // Without it, worklets crash on iOS native release builds
      // (black screen on TestFlight / App Store builds).
      'react-native-reanimated/plugin',
    ],
  };
};
