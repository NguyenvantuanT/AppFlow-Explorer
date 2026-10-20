import React from 'react';
import { Button, Image, Text, View } from 'react-native';

export default function WelcomeScreen({ navigation }) {
  return (
    <View>
      <Image source={require('../../assets/logo.png')} />
      <Text>Cook something great today.</Text>
      <Button title="Get started" onPress={() => navigation.replace('Main')} />
    </View>
  );
}
