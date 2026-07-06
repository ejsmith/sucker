import { registerRootComponent } from 'expo';
import { Platform } from 'react-native';

import App from './App';

if (Platform.OS === 'web' && typeof document !== 'undefined') {
  upsertMeta(
    'viewport',
    'width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=overlays-content',
  );
  upsertMeta('apple-mobile-web-app-capable', 'yes');
  upsertMeta('apple-mobile-web-app-title', 'Sucker!');
  upsertMeta('apple-mobile-web-app-status-bar-style', 'black-translucent');
  upsertLink('manifest', '/manifest.json');
  upsertLink('apple-touch-icon', '/icon.png');
}

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);

function upsertMeta(name: string, content: string) {
  let element = document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
  if (!element) {
    element = document.createElement('meta');
    element.name = name;
    document.head.appendChild(element);
  }

  element.content = content;
}

function upsertLink(rel: string, href: string) {
  let element = document.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (!element) {
    element = document.createElement('link');
    element.rel = rel;
    document.head.appendChild(element);
  }

  element.href = href;
}
