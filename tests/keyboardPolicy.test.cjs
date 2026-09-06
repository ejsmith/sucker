const assert = require('node:assert/strict');
const test = require('node:test');
const { getWindowSoftInputModeMode } = require('@expo/config-plugins/build/android/WindowSoftInputMode');
const { setAndroidOrientation } = require('@expo/config-plugins/build/android/Orientation');
const { setOrientation } = require('@expo/config-plugins/build/ios/Orientation');
const { expo } = require('../app.json');
const webManifest = require('../public/manifest.json');

test('Android keeps the app full size when the keyboard opens', () => {
  assert.equal(getWindowSoftInputModeMode(expo), 'adjustPan');
});

test('native builds and the web manifest only support portrait', () => {
  const activity = { $: { 'android:name': '.MainActivity' } };
  const manifest = { manifest: { application: [{ activity: [activity] }] } };
  setAndroidOrientation(expo, manifest);
  assert.equal(activity.$['android:screenOrientation'], 'portrait');
  const orientations = setOrientation(expo, {}).UISupportedInterfaceOrientations;
  assert.ok(orientations.length > 0);
  assert.ok(orientations.every((orientation) => orientation.startsWith('UIInterfaceOrientationPortrait')));
  assert.equal(expo.ios.requireFullScreen, true);
  assert.equal(expo.web.orientation, 'portrait');
  assert.equal(webManifest.orientation, 'portrait');
});
