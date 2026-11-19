import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { qrMatrix } from './qrMatrix';

// Black on white in every theme: phone cameras read that best, in glare and at night.
const QR_DARK = '#000000';
const QR_LIGHT = '#FFFFFF';
/** The blank border scanners need, in modules. */
const QUIET_MODULES = 4;

/** A QR code drawn with Views, offline, at about `size` points wide. */
export function QrCode({ text, size, accessibilityLabel }: { text: string; size: number; accessibilityLabel: string }) {
  const matrix = useMemo(() => qrMatrix(text), [text]);
  const cell = Math.max(2, Math.floor(size / (matrix.size + QUIET_MODULES * 2)));
  const side = cell * (matrix.size + QUIET_MODULES * 2);
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
      style={[styles.box, { width: side, height: side, backgroundColor: QR_LIGHT }]}
    >
      {matrix.runs.map((run) => (
        <View
          key={`${run.row}:${run.col}`}
          style={{
            position: 'absolute',
            top: (run.row + QUIET_MODULES) * cell,
            left: (run.col + QUIET_MODULES) * cell,
            width: run.length * cell,
            height: cell,
            backgroundColor: QR_DARK,
          }}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    alignSelf: 'center',
    borderRadius: 8,
  },
});
