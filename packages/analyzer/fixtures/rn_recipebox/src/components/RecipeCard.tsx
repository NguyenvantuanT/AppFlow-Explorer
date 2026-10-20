import React from 'react';
import { Image, Pressable, Text } from 'react-native';

export default function RecipeCard({ title, onPress }) {
  return (
    <Pressable onPress={onPress}>
      <Image source={require('../../assets/recipe.png')} />
      <Text>{title}</Text>
    </Pressable>
  );
}
