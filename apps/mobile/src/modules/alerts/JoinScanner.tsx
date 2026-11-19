import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';

import { useStrings, useTheme } from '../../settings/preferences';
import { textStyles } from '../../theme/typography';
import { PanelButton } from '../hike/ui/parts';
import { GroupSheet } from './GroupHikeCard';
import { decodeJoinCode } from './groupMessage';
import strings from './strings';

/**
 * The joiner's QR scanner (#23): the camera, reading QR codes only, offline (expo-camera with
 * ML Kit's bundled model). Hands back the first Tahak Group Hike code it sees; any other QR
 * code just shows a note, and it keeps looking.
 */
export function JoinScanner({ visible, onClose, onScanned }: { visible: boolean; onClose: () => void; onScanned: (qr: string) => void }) {
  const s = useStrings(strings);
  const { colors } = useTheme();
  const [permission, requestPermission] = useCameraPermissions();
  const [wrongCode, setWrongCode] = useState(false);
  const done = useRef(false);
  const lastWrong = useRef<string | null>(null);

  const close = useCallback(() => {
    setWrongCode(false);
    lastWrong.current = null;
    onClose();
  }, [onClose]);

  const scanned = useCallback(
    ({ data }: BarcodeScanningResult) => {
      if (done.current) return;
      if (!decodeJoinCode(data)) {
        if (lastWrong.current !== data) console.log('[nearby] scanned a QR code that is not a Group Hike');
        lastWrong.current = data;
        setWrongCode(true);
        return;
      }
      done.current = true;
      setWrongCode(false);
      onScanned(data);
    },
    [onScanned],
  );

  // Each opening takes one code.
  useEffect(() => {
    if (visible) done.current = false;
  }, [visible]);
  // Once Android stops asking, only the phone's settings can allow the camera.
  const allowCamera = permission && !permission.canAskAgain ? () => void Linking.openSettings() : () => void requestPermission();

  return (
    <GroupSheet visible={visible} onClose={close} title={s.scanTitle} closeLabel={s.cancel}>
      {permission?.granted ? (
        <>
          <View style={[styles.camera, { borderColor: colors.line }]}>
            {visible ? (
              <CameraView
                style={StyleSheet.absoluteFill}
                facing="back"
                barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                onBarcodeScanned={scanned}
              />
            ) : null}
          </View>
          <Text accessibilityLiveRegion="polite" style={[textStyles.body, { color: colors.ink }]}>
            {wrongCode ? s.scanNotGroupCode : s.scanHint}
          </Text>
        </>
      ) : (
        <>
          <Text style={[textStyles.body, { color: colors.ink }]}>{s.cameraNeeded}</Text>
          <PanelButton label={s.allowCamera} icon="camera" onPress={allowCamera} />
        </>
      )}
    </GroupSheet>
  );
}

const styles = StyleSheet.create({
  camera: {
    height: 300,
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
  },
});
