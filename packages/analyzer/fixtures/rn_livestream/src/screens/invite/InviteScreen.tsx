import React from 'react';
import { Button, NativeModules, Platform, View } from 'react-native';

export default function InviteScreen() {
  const { LiveModule, LiveManager } = NativeModules;
  const accept = async () => {
    if (Platform.OS === 'android') {
      await LiveModule.joinStream(7);
    } else {
      await LiveManager.joinStream(7);
    }
  };
  return (
    <View>
      <Button title="Accept" onPress={accept} />
    </View>
  );
}
