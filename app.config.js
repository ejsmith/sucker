const appJson = require('./app.json');

module.exports = ({ config }) => ({
  ...config,
  ...appJson.expo,
  extra: {
    ...config.extra,
    ...appJson.expo.extra,
    webPush: {
      vapidPublicKey: process.env.EXPO_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY ?? '',
    },
  },
});
