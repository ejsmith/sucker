import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { supabase } from './supabase';

export async function registerPushToken(profileId: string) {
  if (!Device.isDevice || (Platform.OS !== 'ios' && Platform.OS !== 'android')) {
    return null;
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  const finalStatus =
    existingStatus === 'granted' ? existingStatus : (await Notifications.requestPermissionsAsync()).status;

  if (finalStatus !== 'granted') {
    return null;
  }

  const token = (await Notifications.getExpoPushTokenAsync()).data;
  const { data, error } = await supabase
    .from('push_tokens')
    .upsert(
      {
        device_name: Device.deviceName ?? null,
        expo_push_token: token,
        platform: Platform.OS,
        profile_id: profileId,
      },
      {
        onConflict: 'expo_push_token',
      },
    )
    .select()
    .single();

  if (error) {
    throw error;
  }

  return data;
}
