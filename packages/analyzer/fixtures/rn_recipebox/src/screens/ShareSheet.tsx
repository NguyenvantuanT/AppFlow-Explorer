import React from 'react';
import { Button, View } from 'react-native';

export default function ShareSheet({ navigation }) {
  return (
    <View>
      <Button title="Close" onPress={() => navigation.goBack()} />
    </View>
  );
}
