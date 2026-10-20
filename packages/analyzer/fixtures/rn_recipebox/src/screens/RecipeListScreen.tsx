import { useNavigation } from '@react-navigation/native';
import React from 'react';
import { FlatList, TextInput, View } from 'react-native';

import RecipeCard from '../components/RecipeCard';
import { Routes } from '../navigation/routes';

export default function RecipeListScreen() {
  const navigation = useNavigation();
  return (
    <View>
      <TextInput placeholder="Search recipes" />
      <FlatList
        data={[]}
        renderItem={({ item }) => (
          <RecipeCard title={item.title} onPress={() => navigation.navigate(Routes.RecipeDetail, { id: item.id })} />
        )}
      />
    </View>
  );
}
