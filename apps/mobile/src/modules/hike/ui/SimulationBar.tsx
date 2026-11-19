import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useState, useSyncExternalStore, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useStrings, useTheme } from '../../../settings/preferences';
import { textStyles } from '../../../theme/typography';
import { fill } from '../format';
import type { SimulatedWalk } from '../simulate/player';
import { SPEEDS } from '../simulate/simLink';
import { simulationLine } from '../simulate/simulationLine';
import strings from '../strings';
import { showDemoDetails } from './demoLayout';

/**
 * Says, the whole time a simulated walk runs, that the position is simulated, at what speed,
 * and how far off the Trail the walk really is (see simulate/simulationLine.ts). Also changes
 * the speed and sends the walk off the Trail on demand (for #8's Deviation). Sky, the info
 * colour; never red.
 */
export function SimulationBar({
  walk,
  offTrailM,
  children,
  alertActive = false,
}: {
  alertActive?: boolean;
  walk: SimulatedWalk;
  /** The real distance from the whole Trail, as the Deviation measures it; null before a position. */
  offTrailM: number | null;
  /** Extra demo controls on their own row (the simulated group member, #24). */
  children?: ReactNode;
}) {
  const s = useStrings(strings);
  const [expanded, setExpanded] = useState(false);
  const { colors } = useTheme();
  const sim = useSyncExternalStore(walk.subscribe, walk.getSnapshot);
  const nextSpeed = SPEEDS.find((speed) => speed > sim.speed) ?? SPEEDS[0];

  return (
    <View
      accessibilityLiveRegion="polite"
      style={[styles.bar, { backgroundColor: colors.sky, borderColor: colors.onSky }]}
    >
      <View style={styles.mainRow}>
        <MaterialCommunityIcons name="walk" size={22} color={colors.onSky} />
        <View style={styles.grow}>
          <Text numberOfLines={1} style={[textStyles.bodyStrong, styles.numbers, { color: colors.onSky }]}>
            {sim.paused
              ? `${s.simulationPausedNote} · ${Math.round(sim.speed)}×`
              : fill(s.simulationRunning, { speed: Math.round(sim.speed) })}
          </Text>
          <Text numberOfLines={1} style={[textStyles.label, styles.numbers, { color: colors.onSky }]}>
            {simulationLine(offTrailM, s)}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={sim.paused ? s.simulationResume : s.simulationPause}
          onPress={() => (sim.paused ? walk.resume() : walk.pause())}
          style={({ pressed }) => [styles.button, { backgroundColor: colors.surface, opacity: pressed ? 0.85 : 1 }]}
        >
          <MaterialCommunityIcons name={sim.paused ? 'play' : 'pause'} size={18} color={colors.ink} />

        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityHint={s.simulationSpeedHint}
          onPress={() => walk.setSpeed(nextSpeed)}
          style={({ pressed }) => [styles.button, { backgroundColor: colors.surface, opacity: pressed ? 0.85 : 1 }]}
        >
          <MaterialCommunityIcons name="fast-forward" size={18} color={colors.ink} />
          <Text style={[textStyles.labelStrong, styles.numbers, { color: colors.ink }]}>
            {fill(s.simulationSpeed, { speed: nextSpeed })}
          </Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={expanded ? s.demoCollapse : s.demoExpand} accessibilityState={{ expanded: showDemoDetails(expanded, alertActive) }} onPress={() => setExpanded(!expanded)} style={styles.toggle}>
          <MaterialCommunityIcons name={showDemoDetails(expanded, alertActive) ? "chevron-up" : "chevron-down"} size={22} color={colors.onSky} />
        </Pressable>
      </View>
      {showDemoDetails(expanded, alertActive) ? <View style={styles.row}>
        <Pressable
          accessibilityRole="button"
          onPress={() => walk.goOffTrail()}
          style={({ pressed }) => [styles.button, { backgroundColor: colors.surface, opacity: pressed ? 0.85 : 1 }]}
        >
          <MaterialCommunityIcons name="call-split" size={18} color={colors.ink} />
          <Text style={[textStyles.labelStrong, { color: colors.ink }]}>{s.goOffTrail}</Text>
        </Pressable>
      {children}
      </View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    borderRadius: 14,
    borderWidth: 1.5,
    padding: 10,
    gap: 8,
    elevation: 3,
  },
  mainRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
  },
  grow: {
    flex: 1,
  },
  toggle: { minWidth: 40, minHeight: 40, alignItems: "center", justifyContent: "center" },
  numbers: {
    fontVariant: ['tabular-nums'],
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 40,
    paddingHorizontal: 8,
    borderRadius: 10,
  },
});
