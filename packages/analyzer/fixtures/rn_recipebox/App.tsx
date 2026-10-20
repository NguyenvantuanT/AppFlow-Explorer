import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import React from 'react';

import MainTabs from './src/navigation/MainTabs';
import { Routes } from './src/navigation/routes';
import CookingScreen from './src/screens/CookingScreen';
import RecipeDetailScreen from './src/screens/RecipeDetailScreen';
import ShareSheet from './src/screens/ShareSheet';
import WelcomeScreen from './src/screens/WelcomeScreen';

const RootStack = createNativeStackNavigator();

export default function App() {
  return (
    <NavigationContainer>
      <RootStack.Navigator initialRouteName="Welcome">
        <RootStack.Screen name="Welcome" component={WelcomeScreen} />
        <RootStack.Screen name="Main" component={MainTabs} options={{ headerShown: false }} />
        <RootStack.Screen name={Routes.RecipeDetail} component={RecipeDetailScreen} />
        <RootStack.Screen name={Routes.Cooking} component={CookingScreen} />
        <RootStack.Group screenOptions={{ presentation: 'modal' }}>
          <RootStack.Screen name="Share" component={ShareSheet} />
        </RootStack.Group>
      </RootStack.Navigator>
    </NavigationContainer>
  );
}
