import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';
import { supabase } from './supabase';

const avatarBucket = 'avatars';
const avatarSize = 512;
const maximumSourceBytes = 15 * 1024 * 1024;
const maximumSourceDimension = 16_384;

export type AvatarSource = 'camera' | 'library';

export async function selectAvatar(source: AvatarSource) {
  if (source === 'camera' && Platform.OS !== 'web') {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      throw new Error('Camera access is required to take a profile photo. You can still choose one from photos.');
    }
  }

  const options: ImagePicker.ImagePickerOptions = {
    allowsEditing: Platform.OS !== 'web',
    aspect: [1, 1],
    cameraType: ImagePicker.CameraType.front,
    mediaTypes: ['images'],
    quality: 0.9,
  };
  const result =
    source === 'camera'
      ? await ImagePicker.launchCameraAsync(options)
      : await ImagePicker.launchImageLibraryAsync(options);

  if (result.canceled || !result.assets[0]) {
    return null;
  }

  return processAvatar(result.assets[0]);
}

export async function recoverPendingAvatar() {
  if (Platform.OS !== 'android') {
    return null;
  }

  const result = await ImagePicker.getPendingResultAsync();
  if (!result) {
    return null;
  }
  if ('code' in result) throw new Error(result.message || 'Unable to recover the selected photo.');
  if (result.canceled || !result.assets[0]) return null;

  return processAvatar(result.assets[0]);
}

async function processAvatar(asset: ImagePicker.ImagePickerAsset) {
  if (asset.fileSize && asset.fileSize > maximumSourceBytes) {
    throw new Error('Choose a photo smaller than 15 MB.');
  }
  if (
    asset.width <= 0 ||
    asset.height <= 0 ||
    asset.width > maximumSourceDimension ||
    asset.height > maximumSourceDimension
  ) {
    throw new Error('That photo is too large to process. Choose a smaller image.');
  }

  const square = Math.min(asset.width, asset.height);
  const context = ImageManipulator.manipulate(asset.uri);
  context.crop({
    height: square,
    originX: Math.max(0, (asset.width - square) / 2),
    originY: Math.max(0, (asset.height - square) / 2),
    width: square,
  });
  context.resize({ height: avatarSize, width: avatarSize });
  const rendered = await context.renderAsync();
  return rendered.saveAsync({ compress: 0.82, format: SaveFormat.JPEG });
}

export async function uploadAvatar(uri: string, previousAvatarUrl?: string | null) {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError) throw userError;
  if (!user) throw new Error('You must be signed in to change your avatar.');

  const response = await fetch(uri);
  if (!response.ok) {
    throw new Error('Unable to read the selected photo.');
  }
  const body = await response.arrayBuffer();
  const objectId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const path = `${user.id}/${objectId}.jpg`;
  const { error: uploadError } = await supabase.storage.from(avatarBucket).upload(path, body, {
    cacheControl: '31536000',
    contentType: 'image/jpeg',
    upsert: false,
  });
  if (uploadError) throw uploadError;

  const { data } = supabase.storage.from(avatarBucket).getPublicUrl(path);
  const { error: profileError } = await supabase
    .from('profiles')
    .update({ avatar_url: data.publicUrl })
    .eq('id', user.id)
    .select('id')
    .single();
  if (profileError) {
    await supabase.storage.from(avatarBucket).remove([path]);
    throw profileError;
  }

  await removeOwnedAvatarObject(previousAvatarUrl, user.id);
  return data.publicUrl;
}

export async function removeAvatar(avatarUrl?: string | null) {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError) throw userError;
  if (!user) throw new Error('You must be signed in to remove your avatar.');

  const { error } = await supabase
    .from('profiles')
    .update({ avatar_url: null })
    .eq('id', user.id)
    .select('id')
    .single();
  if (error) throw error;
  await removeOwnedAvatarObject(avatarUrl, user.id);
}

async function removeOwnedAvatarObject(avatarUrl: string | null | undefined, profileId: string) {
  const marker = `/storage/v1/object/public/${avatarBucket}/`;
  if (!avatarUrl) return;

  try {
    const pathname = new URL(avatarUrl).pathname;
    const markerIndex = pathname.indexOf(marker);
    if (markerIndex < 0) return;
    const path = decodeURIComponent(pathname.slice(markerIndex + marker.length));
    if (!path.startsWith(`${profileId}/`)) return;
    const { error } = await supabase.storage.from(avatarBucket).remove([path]);
    if (error) console.warn('Unable to remove previous avatar object', error);
  } catch {
    // An old or malformed URL should not prevent the new avatar from being saved.
  }
}
