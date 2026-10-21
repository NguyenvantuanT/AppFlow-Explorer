import { NativeModules, Platform } from 'react-native';

const useLiveSetup = () => {
  const { LiveModule, LiveManager } = NativeModules;
  const startLive = async () => {
    if (Platform.OS === 'android') {
      await LiveModule.startStream(1, 'My stream');
    } else {
      await LiveManager.startStream(1, 'My stream');
    }
  };
  const setProfile = () => LiveModule.setProfile('me');
  return { startLive, setProfile };
};

export default useLiveSetup;
