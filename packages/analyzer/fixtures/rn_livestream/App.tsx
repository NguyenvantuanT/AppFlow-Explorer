import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { HomeScreen, LiveSetupScreen, InviteScreen } from '@/screens';

const Stack = createNativeStackNavigator();

export default function App() {
  return (
    <NavigationContainer>
      <Stack.Navigator initialRouteName="Home">
        <Stack.Screen name="Home" component={HomeScreen} />
        <Stack.Screen name="LiveSetup" component={LiveSetupScreen} />
        <Stack.Screen name="Invite" component={InviteScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
