import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useGroupAlertNotifications } from './modules/alerts';
import { PreferencesProvider } from './settings/preferences';
import { AppShell } from './shell/AppShell';

function AlertsListener() {
  useGroupAlertNotifications();
  return null;
}

export default function App() {
  return (
    <SafeAreaProvider>
      <PreferencesProvider>
        <AlertsListener />
        <AppShell />
      </PreferencesProvider>
    </SafeAreaProvider>
  );
}
