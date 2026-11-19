import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useState, type ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useStrings, useTheme } from '../../../settings/preferences';
import { textStyles } from '../../../theme/typography';
import type { Trail } from '../../destination-pack';
import { fill, formatKm } from '../format';
import type { DestinationChoice } from '../latestPack';
import strings from '../strings';
import { Panel, PanelButton } from './parts';

/** A small sheet from the bottom of the screen, over a scrim that closes it. */
function Sheet({
  visible,
  onClose,
  title,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const s = useStrings(strings);
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={s.close}
        style={[styles.grow, { backgroundColor: colors.scrim }]}
        onPress={onClose}
      />
      <View style={[styles.sheet, { backgroundColor: colors.surface, paddingBottom: 16 + insets.bottom }]}>
        <Text accessibilityRole="header" style={[textStyles.title, { color: colors.ink }]}>
          {title}
        </Text>
        {children}
        <PanelButton label={s.close} onPress={onClose} />
      </View>
    </Modal>
  );
}

/**
 * Which downloaded Destination the Hike tab shows ("Mt. Batulao ▾"), with a sheet listing
 * every downloaded one (issue #52). Locked during a Hike.
 */
function DestinationChooser({
  destinationId,
  destinations,
  onChoose,
  locked,
}: {
  destinationId: string;
  destinations: readonly DestinationChoice[];
  onChoose: (destinationId: string) => void;
  locked: boolean;
}) {
  const s = useStrings(strings);
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const current = destinations.find((choice) => choice.id === destinationId);
  const canSwitch = !locked && destinations.length > 1;

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={fill(s.destinationCurrent, { name: current?.name ?? '' })}
        accessibilityHint={locked ? s.destinationLockedHint : s.destinationHint}
        accessibilityState={{ disabled: !canSwitch }}
        disabled={!canSwitch}
        onPress={() => setOpen(true)}
        style={({ pressed }) => [
          styles.chooser,
          { borderColor: colors.line, backgroundColor: colors.surface, opacity: pressed ? 0.85 : 1 },
        ]}
      >
        <MaterialCommunityIcons name="terrain" size={22} color={colors.primary} />
        <Text style={[textStyles.bodyStrong, styles.grow, { color: colors.ink }]}>{current?.name}</Text>
        {canSwitch ? <MaterialCommunityIcons name="chevron-down" size={24} color={colors.ink} /> : null}
      </Pressable>
      <Sheet visible={open} onClose={() => setOpen(false)} title={s.chooseDestination}>
        <View accessibilityRole="radiogroup" style={styles.list}>
          {destinations.map((choice) => {
            const selected = choice.id === destinationId;
            return (
              <Pressable
                key={choice.id}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                onPress={() => {
                  setOpen(false);
                  if (!selected) onChoose(choice.id);
                }}
                style={({ pressed }) => [
                  styles.trail,
                  {
                    backgroundColor: selected ? colors.tint : colors.surface,
                    borderColor: selected ? colors.primary : colors.line,
                    opacity: pressed ? 0.85 : 1,
                  },
                ]}
              >
                <MaterialCommunityIcons
                  name={selected ? 'radiobox-marked' : 'radiobox-blank'}
                  size={22}
                  color={selected ? colors.onTint : colors.muted}
                />
                <Text style={[textStyles.bodyStrong, styles.grow, { color: colors.ink }]}>{choice.name}</Text>
              </Pressable>
            );
          })}
        </View>
      </Sheet>
    </>
  );
}

export type HikeMode = 'solo' | 'group';

/**
 * Solo | Group (issues #24 and #23). Solo Hike is the default. Group shows the hiker's name in
 * the group, and the card's Start becomes "Start Group Hike" (leader, shows a QR code) and
 * "Scan to join". Olive only, never red.
 */
function HikeModeChoice({ mode, onChange }: { mode: HikeMode; onChange: (mode: HikeMode) => void }) {
  const s = useStrings(strings);
  const { colors } = useTheme();
  const option = (value: HikeMode, label: string, icon: 'account' | 'account-group') => {
    const selected = mode === value;
    return (
      <Pressable
        accessibilityRole="radio"
        accessibilityState={{ checked: selected }}
        onPress={() => onChange(value)}
        style={({ pressed }) => [
          styles.segment,
          { backgroundColor: selected ? colors.primary : 'transparent', opacity: pressed ? 0.85 : 1 },
        ]}
      >
        <MaterialCommunityIcons name={icon} size={18} color={selected ? colors.onPrimary : colors.muted} />
        <Text style={[textStyles.bodyStrong, { color: selected ? colors.onPrimary : colors.muted }]}>{label}</Text>
      </Pressable>
    );
  };

  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={s.hikeModeLabel}
      style={[styles.segmented, { borderColor: colors.line }]}
    >
      {option('solo', s.soloHike, 'account')}
      {option('group', s.groupHike, 'account-group')}
    </View>
  );
}

/** Group mode: the name the others see on this phone's dot. */
function GroupNameField({ name, onChange }: { name: string; onChange: (name: string) => void }) {
  const s = useStrings(strings);
  const { colors } = useTheme();
  return (
    <View style={styles.nameField}>
      <View style={styles.simRow}>
        <MaterialCommunityIcons name="qrcode" size={22} color={colors.primary} />
        <Text style={[textStyles.label, styles.grow, { color: colors.muted }]}>{s.groupModeHint}</Text>
      </View>
      <Text style={[textStyles.labelStrong, { color: colors.ink }]}>{s.memberNameLabel}</Text>
      <TextInput
        accessibilityLabel={s.memberNameLabel}
        accessibilityHint={name.trim() ? undefined : s.memberNameNeeded}
        value={name}
        onChangeText={onChange}
        placeholder={s.memberNamePlaceholder}
        placeholderTextColor={colors.muted}
        maxLength={MEMBER_NAME_MAX}
        autoCapitalize="words"
        autoCorrect={false}
        returnKeyType="done"
        style={[textStyles.body, styles.input, { color: colors.ink, borderColor: colors.line, backgroundColor: colors.page }]}
      />
      {name.trim() ? null : <Text style={[textStyles.label, { color: colors.muted }]}>{s.memberNameNeeded}</Text>}
    </View>
  );
}

/** The longest name a Group Hike carries (alerts/groupMessage.ts MAX_NAME_LENGTH). */
const MEMBER_NAME_MAX = 40;

/**
 * Before a Hike: the Destination choice, Solo | Group, the downloaded Destination's Trails (name and distance) to choose from, the
 * simulated-walk switch for demos, and a large olive Start Hike button. A Hike needs a Trail.
 * In Group mode the start is "Start Group Hike" or "Scan to join", and needs a name.
 */
export function TrailPickerCard({
  destinationId,
  destinations,
  onChooseDestination,
  destinationLocked,
  trails,
  selectedId,
  onSelect,
  simulate,
  onSimulateChange,
  onStart,
  mode,
  onModeChange,
  memberName,
  onMemberNameChange,
  onStartGroup,
  onJoinGroup,
}: {
  destinationId: string;
  destinations: readonly DestinationChoice[];
  onChooseDestination: (destinationId: string) => void;
  destinationLocked: boolean;
  trails: readonly Trail[];
  selectedId: string | null;
  onSelect: (trailId: string) => void;
  simulate: boolean;
  onSimulateChange: (simulate: boolean) => void;
  onStart: () => void;
  mode: HikeMode;
  onModeChange: (mode: HikeMode) => void;
  memberName: string;
  onMemberNameChange: (name: string) => void;
  onStartGroup: () => void;
  onJoinGroup: () => void;
}) {
  const s = useStrings(strings);
  const { colors } = useTheme();

  return (
    <Panel>
      <DestinationChooser
        destinationId={destinationId}
        destinations={destinations}
        onChoose={onChooseDestination}
        locked={destinationLocked}
      />
      <HikeModeChoice mode={mode} onChange={onModeChange} />
      {mode === 'group' ? <GroupNameField name={memberName} onChange={onMemberNameChange} /> : null}
      <Text accessibilityRole="header" style={[textStyles.heading, { color: colors.ink }]}>
        {s.pickTrail}
      </Text>
      {trails.length === 0 ? (
        <Text style={[textStyles.body, { color: colors.ink }]}>{s.noTrails}</Text>
      ) : (
        <View accessibilityRole="radiogroup" style={styles.list}>
          {trails.map((trail) => {
            const selected = trail.id === selectedId;
            return (
              <Pressable
                key={trail.id}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                onPress={() => onSelect(trail.id)}
                style={({ pressed }) => [
                  styles.trail,
                  {
                    backgroundColor: selected ? colors.tint : colors.surface,
                    borderColor: selected ? colors.primary : colors.line,
                    opacity: pressed ? 0.85 : 1,
                  },
                ]}
              >
                <MaterialCommunityIcons
                  name={selected ? 'radiobox-marked' : 'radiobox-blank'}
                  size={22}
                  color={selected ? colors.onTint : colors.muted}
                />
                <View style={[styles.tile, { backgroundColor: colors.peach }]}>
                  <MaterialCommunityIcons name="map-marker-path" size={18} color={colors.onPeach} />
                </View>
                <Text style={[textStyles.bodyStrong, styles.grow, { color: colors.ink }]}>{trail.name}</Text>
                <Text style={[textStyles.bodyStrong, styles.numbers, { color: colors.ink }]}>
                  {fill(s.trailDistance, { km: formatKm(trail.distanceM) })}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}

      <View style={styles.simRow}>
        {/* A demo aid, so it stays quiet: one muted line, the explanation read out as a hint. */}
        <MaterialCommunityIcons name="walk" size={16} color={colors.muted} />
        <Text style={[textStyles.label, styles.grow, { color: colors.muted }]}>{s.simulatedWalk}</Text>
        <Switch
          accessibilityLabel={s.simulatedWalk}
          accessibilityHint={s.simulatedWalkHint}
          style={styles.simSwitch}
          value={simulate}
          onValueChange={onSimulateChange}
          trackColor={{ false: colors.line, true: colors.sky }}
          thumbColor={simulate ? colors.onSky : colors.surface}
        />
      </View>

      {mode === 'group' ? (
        <View style={styles.groupButtons}>
          <PanelButton
            label={s.startGroupHike}
            icon="qrcode"
            large
            onPress={onStartGroup}
            accessibilityHint={s.startGroupHikeHint}
            disabled={selectedId === null || trails.length === 0 || !memberName.trim()}
          />
          <PanelButton
            label={s.joinGroupHike}
            icon="qrcode-scan"
            kind="tint"
            onPress={onJoinGroup}
            accessibilityHint={s.joinGroupHikeHint}
            disabled={selectedId === null || trails.length === 0 || !memberName.trim()}
          />
        </View>
      ) : (
        <PanelButton
          label={s.startHike}
          icon="hiking"
          large
          onPress={onStart}
          disabled={selectedId === null || trails.length === 0}
        />
      )}
    </Panel>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: 8,
  },
  trail: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 52,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1.5,
  },
  tile: {
    width: 30,
    height: 30,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  grow: {
    flex: 1,
  },
  numbers: {
    fontVariant: ['tabular-nums'],
  },
  chooser: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 48,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1.5,
  },
  segmented: {
    flexDirection: 'row',
    borderRadius: 12,
    borderWidth: 1.5,
    overflow: 'hidden',
  },
  segment: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    // With wrap on, alignContent (default flex-start) places the line, so center it too.
    alignContent: 'center',
    flexWrap: 'wrap',
    gap: 6,
    minHeight: 48,
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  nameField: {
    gap: 6,
  },
  input: {
    minHeight: 48,
    borderWidth: 1.5,
    borderRadius: 12,
    paddingHorizontal: 12,
  },
  groupButtons: {
    gap: 8,
  },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 20,
    gap: 14,
  },
  simRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  simSwitch: {
    transform: [{ scale: 0.8 }],
  },
});
