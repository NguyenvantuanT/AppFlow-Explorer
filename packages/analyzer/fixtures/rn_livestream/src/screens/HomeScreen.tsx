import React from 'react';
import { Button, View } from 'react-native';

const HomeScreen = ({ navigation }: any) => {
  return (
    <View>
      <Button title="Go live" onPress={() => navigation.navigate('LiveSetup')} />
      <Button title="Invitations" onPress={() => navigation.navigate('Invite')} />
    </View>
  );
};

export default HomeScreen;
