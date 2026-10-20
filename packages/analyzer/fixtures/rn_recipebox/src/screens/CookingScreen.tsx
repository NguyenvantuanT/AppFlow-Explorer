import React from 'react';
import { Button, View } from 'react-native';

export default function CookingScreen({ navigation }) {
  return (
    <View>
      <Button
        title="Done"
        onPress={() => navigation.reset({ index: 0, routes: [{ name: 'Main' }] })}
      />
    </View>
  );
}
