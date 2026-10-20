import React from 'react';
import { Button, NativeModules, View } from 'react-native';

export default function RecipeDetailScreen({ navigation, route }) {
  const handleStartCooking = () => {
    navigation.push('Cooking', { id: route.params.id });
  };
  const next = route.params.next;

  return (
    <View>
      <Button title="Start cooking" onPress={handleStartCooking} />
      <Button title="Share" onPress={() => navigation.navigate('Share')} />
      <Button title="Up next" onPress={() => navigation.navigate(next)} />
      <Button title="Buy ingredients" onPress={() => NativeModules.Payments.openCheckout(route.params.id)} />
    </View>
  );
}
