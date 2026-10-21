import React from 'react';
import { Button, View } from 'react-native';
import useLiveSetup from '~hooks/useLiveSetup';

export function LiveSetupScreen() {
  const { startLive } = useLiveSetup();
  return (
    <View>
      <Button title="Start" onPress={startLive} />
    </View>
  );
}
