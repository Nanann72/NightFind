// Entry point with boot diagnostics.
// If the app fails to initialize at module scope (native module missing,
// incompatible dependency, etc.), display the error on screen instead of
// leaving an endless black screen in release builds.
try {
  require('expo-router/entry');
} catch (e) {
  const React = require('react');
  const { AppRegistry, ScrollView, Text } = require('react-native');
  const msg = `NIGHT FINDER — BOOT ERROR\n\n${(e && (e.stack || e.message)) || String(e)}`;
  function BootError() {
    return React.createElement(
      ScrollView,
      {
        style: { flex: 1, backgroundColor: '#7f1d1d' },
        contentContainerStyle: { padding: 32, paddingTop: 80 },
      },
      React.createElement(
        Text,
        { style: { color: '#ffffff', fontSize: 13, fontFamily: 'Courier' }, selectable: true },
        msg,
      ),
    );
  }
  AppRegistry.registerComponent('main', () => BootError);
}
