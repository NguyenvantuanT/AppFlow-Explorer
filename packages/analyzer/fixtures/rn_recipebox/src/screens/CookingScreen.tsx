import React from 'react';
import { Button, NativeModules, View } from 'react-native';

const { CookingTimer } = NativeModules;

export default function CookingScreen({ navigation }) {
  return (
    <View>
      <Button title="Scan ingredients" onPress={() => CookingTimer.openScanner()} />
      <Button
        title="Done"
        onPress={() => navigation.reset({ index: 0, routes: [{ name: 'Main' }] })}
      />
    </View>
  );
}
