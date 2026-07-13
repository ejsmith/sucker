import { useState } from 'react';
import { Image } from 'expo-image';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

export function PlayerAvatar({
  avatarUrl,
  name,
  size,
  style,
  testID,
}: {
  avatarUrl?: string | null;
  name: string;
  size: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const showImage = Boolean(avatarUrl && failedUrl !== avatarUrl);

  return (
    <View
      accessibilityLabel={`${name}'s profile avatar`}
      accessibilityRole="image"
      style={[styles.frame, { borderRadius: size / 2, height: size, width: size }, style]}
      testID={testID}
    >
      {showImage ? (
        <Image
          cachePolicy="memory-disk"
          contentFit="cover"
          onError={() => setFailedUrl(avatarUrl ?? null)}
          source={avatarUrl}
          style={StyleSheet.absoluteFill}
          testID={testID ? `${testID}-image` : undefined}
        />
      ) : (
        <Text style={[styles.initial, { fontSize: Math.max(14, size * 0.44) }]}>
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
