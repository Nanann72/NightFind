module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // ⚠️ DO NOT add 'react-native-worklets/plugin' or
    // 'react-native-reanimated/plugin' here. babel-preset-expo (SDK 54+)
    // injects the worklets plugin AUTOMATICALLY when react-native-worklets
    // is installed. Manually re-adding it creates a double-transformation
    // that silently corrupts the worklet runtime on iOS release builds
    // (TestFlight → instant black screen at startup). This was the exact
    // cause of the black screen on builds 113-118.
  };
};
