import { useState } from 'react';
import { Image, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';

export function PlayerAvatar({
  avatarUrl,
  decorative = false,
  fontFamily,
  initialStyle,
  name,
  size,
  style,
  testID,
}: {
  avatarUrl?: string | null;
  decorative?: boolean;
  fontFamily?: TextStyle['fontFamily'];
  initialStyle?: StyleProp<TextStyle>;
  name: string;
  size: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const showImage = Boolean(avatarUrl && failedUrl !== avatarUrl);

  return (
    <View
      accessibilityElementsHidden={decorative}
      accessibilityLabel={decorative ? undefined : `${name}'s profile avatar`}
      accessible={!decorative}
      aria-hidden={decorative || undefined}
      importantForAccessibility={decorative ? 'no-hide-descendants' : 'auto'}
      style={[styles.frame, { borderRadius: size / 2, height: size, width: size }, style]}
      testID={testID}
    >
      {showImage ? (
        <Image
          onError={() => setFailedUrl(avatarUrl ?? null)}
          resizeMode="cover"
          source={{ uri: avatarUrl ?? undefined }}
          style={StyleSheet.absoluteFill}
          testID={testID ? `${testID}-image` : undefined}
        />
      ) : (
        <Text
          maxFontSizeMultiplier={1.2}
          style={[styles.initial, { fontFamily, fontSize: Math.max(14, size * 0.44) }, initialStyle]}
        >
          {name.trim().slice(0, 1).toUpperCase() || '?'}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    alignItems: 'center',
    backgroundColor: '#160303',
    borderColor: '#FFD329',
    borderWidth: 3,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  initial: {
    color: '#FFFFFF',
    fontWeight: '900',
  },
});
