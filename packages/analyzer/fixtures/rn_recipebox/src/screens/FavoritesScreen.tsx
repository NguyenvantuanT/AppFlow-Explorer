import React from 'react';
import { Button, View } from 'react-native';

export default function FavoritesScreen({ navigation }) {
  return (
    <View>
      {/* "Settings" is not registered in any navigator. */}
      <Button title="Settings" onPress={() => navigation.navigate('Settings')} />
    </View>
  );
}
