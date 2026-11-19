import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useState, type ComponentProps, type ReactNode } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useStrings, useTheme } from '../../settings/preferences';
import { textStyles } from '../../theme/typography';
import { fill } from '../hike/format';
import { memberList, type GroupHike } from './groupHike';
import { groupSession, useGroupSession } from './groupHikeService';
import { decodeJoinCode } from './groupMessage';
import type { GroupSessionError } from './groupSession';
import { initials } from './memberState';
import { QrCode } from './QrCode';
import strings from './strings';

type Strings = (typeof strings)['en'];
type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

const ERROR_TEXT: Record<GroupSessionError, keyof Strings> = {
  unavailable: 'groupErrorUnavailable',
  permission: 'groupErrorPermission',
  radio: 'groupErrorRadio',
  'bad-code': 'groupErrorBadCode',
};

/** The one line that says where this phone's Group Hike stands. */
export function groupStatusText(s: Strings, group: GroupHike | null, busy: boolean): string {
  if (busy || !group) return s.groupStarting;
  const count = String(Object.keys(group.members).length);
  switch (group.status) {
    case 'leading':
      return fill(s.groupLeading, { count });
    case 'joining':
      return s.groupJoining;
    case 'joined':
      return fill(s.groupJoined, { count });
    case 'dissolved':
      return group.endReason === 'leader-lost' ? s.groupLeaderLost : s.groupEndedByLeader;
    default:
      return s.groupStarting;
  }
}

/** A bottom sheet over a scrim that closes it. */
export function GroupSheet({
  visible,
  onClose,
  title,
  closeLabel,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  closeLabel: string;
  children: ReactNode;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={closeLabel}
        style={[styles.grow, { backgroundColor: colors.scrim }]}
        onPress={onClose}
      />
      <View style={[styles.sheet, { backgroundColor: colors.surface, paddingBottom: 16 + insets.bottom }]}>
        <Text accessibilityRole="header" style={[textStyles.title, { color: colors.ink }]}>
          {title}
        </Text>
        {children}
        <SmallButton label={closeLabel} icon="close" onPress={onClose} wide />
      </View>
    </Modal>
  );
}

function SmallButton({
  label,
  icon,
  onPress,
  hint,
  wide = false,
}: {
  label: string;
  icon: IconName;
  onPress: () => void;
  hint?: string;
  wide?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityHint={hint}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        wide ? styles.wide : null,
        { backgroundColor: colors.tint, opacity: pressed ? 0.85 : 1 },
      ]}
    >
      <MaterialCommunityIcons name={icon} size={18} color={colors.onTint} />
      <Text style={[textStyles.labelStrong, { color: colors.onTint }]}>{label}</Text>
    </Pressable>
  );
}

/**
 * The running Hike's Group Hike (#23): where it stands, who is in it (olive initials, as on
 * the map), the leader's QR code, and what to do if it could not start. Never red: nothing
 * here is a danger (ADR 0004); a member's own Deviation or Flare shows on their dot and banner.
 */
export function GroupHikeCard({ hikeId }: { hikeId: number }) {
  const s = useStrings(strings);
  const { colors } = useTheme();
  const view = useGroupSession();
  // The QR code the sheet is open for. The leader's opens by itself once, as soon as the
  // group is advertising (React's pattern for state that follows a changing value).
  const [openFor, setOpenFor] = useState<string | null>(null);
  const [seenQr, setSeenQr] = useState<string | null>(null);
  if (view.qr !== seenQr) {
    setSeenQr(view.qr);
    if (view.qr) setOpenFor(view.qr);
  }
  const qrOpen = view.qr !== null && openFor === view.qr;
  const setQrOpen = (open: boolean) => setOpenFor(open ? view.qr : null);

  if (view.hikeId !== hikeId) return null;
  const { group, error, busy, qr } = view;
  const rows = group ? memberList(group) : [];
  const role = group?.role ?? null;
  const joinCode = qr ? (decodeJoinCode(qr)?.secret ?? '') : '';

  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.line }]}>
      <View style={styles.row}>
        <MaterialCommunityIcons name="account-group" size={22} color={colors.primary} />
        <View style={styles.grow}>
          <Text style={[textStyles.labelStrong, { color: colors.muted }]}>{s.groupTitle}</Text>
          <Text accessibilityLiveRegion="polite" style={[textStyles.bodyStrong, { color: colors.ink }]}>
            {error ? s[ERROR_TEXT[error]] : groupStatusText(s, group, busy)}
          </Text>
        </View>
        {busy || group?.status === 'joining' ? <ActivityIndicator color={colors.primary} /> : null}
      </View>

      {rows.length > 0 && group?.status !== 'dissolved' ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.members}>
          {rows.map((member) => (
            <View key={member.id} style={styles.member}>
              <View style={[styles.dot, { backgroundColor: colors.primary }]}>
                <Text style={[textStyles.labelStrong, { color: colors.onPrimary }]}>{initials(member.name)}</Text>
              </View>
              <Text numberOfLines={1} style={[textStyles.label, { color: colors.ink }]}>
                {member.isSelf
                  ? fill(s.memberYou, { name: member.name })
                  : member.isLeader
                    ? fill(s.memberLeader, { name: member.name })
                    : member.name}
              </Text>
            </View>
          ))}
        </ScrollView>
      ) : null}

      <View style={styles.actions}>
        {qr && role === 'leader' && group?.status === 'leading' ? (
          <SmallButton label={s.groupShowQr} icon="qrcode" onPress={() => setQrOpen(true)} />
        ) : null}
        {error && error !== 'unavailable' ? (
          <SmallButton label={s.groupTryAgain} icon="refresh" onPress={() => void groupSession.retry()} />
        ) : null}
        {role === 'member' && (group?.status === 'joining' || group?.status === 'joined') ? (
          <SmallButton
            label={s.groupLeave}
            icon="account-arrow-right"
            hint={s.groupLeaveHint}
            onPress={() => void groupSession.end()}
          />
        ) : null}
      </View>

      <GroupSheet visible={qrOpen && qr !== null} onClose={() => setQrOpen(false)} title={s.qrTitle} closeLabel={s.close}>
        {qr ? <QrCode text={qr} size={260} accessibilityLabel={fill(s.qrLabel, { code: joinCode })} /> : null}
        <Text style={[textStyles.heading, styles.center, { color: colors.ink }]}>{fill(s.qrJoinCode, { code: joinCode })}</Text>
        <Text style={[textStyles.body, { color: colors.ink }]}>{s.qrBody}</Text>
      </GroupSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 10,
    gap: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  grow: {
    flex: 1,
  },
  members: {
    gap: 12,
  },
  member: {
    alignItems: 'center',
    gap: 2,
    maxWidth: 88,
  },
  dot: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 40,
    paddingHorizontal: 12,
    borderRadius: 10,
  },
  wide: {
    minHeight: 48,
  },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 20,
    gap: 14,
  },
  center: {
    textAlign: 'center',
  },
});
