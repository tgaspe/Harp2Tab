import { Poppins, SpaceGrotesk } from '@/constants/fonts';
import { FONT } from '@/constants/keys';
import { useTheme } from '@/hooks/useTheme';
import { useSettingsStore } from '@/store/useSettingsStore';
import type { Theme } from '@/theme';
import { Ionicons } from '@expo/vector-icons';
import React, { useMemo } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

interface Props {
  visible: boolean;
  onClose: () => void;
  onUpgrade: () => void;
}

export function RatingModal({ visible, onClose, onUpgrade }: Props) {
  const theme           = useTheme();
  const styles          = useMemo(() => createStyles(theme), [theme]);
  const setRatingStatus = useSettingsStore((s) => s.setRatingStatus);

  function handleRate() {
    setRatingStatus('rated');
    onClose();
  }

  function handleUpgrade() {
    setRatingStatus('declined');
    onClose();
    onUpgrade();
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <View style={styles.card}>

          <View style={styles.stars}>
            {[1, 2, 3, 4, 5].map((i) => (
              <Ionicons key={i} name="star" size={28} color={theme.accent} />
            ))}
          </View>

          <Text style={styles.title}>Enjoying Harp2Tab?</Text>

          <Text style={styles.body}>
            Rate us on the Play Store and unlock{' '}
            <Text style={styles.highlight}>5 more free recordings</Text>
            {' '}— on us.
          </Text>

          <Pressable
            onPress={handleRate}
            style={({ pressed }) => [styles.rateBtn, pressed && { opacity: 0.85 }]}
            accessibilityRole="button"
          >
            <Ionicons name="star" size={18} color="#fff" />
            <Text style={styles.rateBtnText}>Rate &amp; Get 5 More</Text>
          </Pressable>

          <Pressable
            onPress={handleUpgrade}
            style={({ pressed }) => [styles.upgradeBtn, pressed && { opacity: 0.7 }]}
            accessibilityRole="button"
          >
            <Text style={styles.upgradeBtnText}>Upgrade to Premium</Text>
          </Pressable>

        </View>
      </View>
    </Modal>
  );
}

function createStyles(t: Theme) {
  return StyleSheet.create({
    backdrop: {
      flex:              1,
      backgroundColor:   'rgba(0,0,0,0.65)',
      alignItems:        'center',
      justifyContent:    'center',
      paddingHorizontal: 32,
    },
    card: {
      backgroundColor:   t.bg,
      borderRadius:      24,
      paddingHorizontal: 28,
      paddingVertical:   36,
      alignItems:        'center',
      gap:               14,
      width:             '100%',
      borderWidth:       1,
      borderColor:       t.border,
    },
    stars: {
      flexDirection: 'row',
      gap:           6,
      marginBottom:  4,
    },
    title: {
      fontSize:      FONT.xl,
      marginTop:     4,
      fontFamily:    SpaceGrotesk.bold,
      color:         t.textPrimary,
      textAlign:     'center',
      letterSpacing: -0.4,
    },
    body: {
      fontSize:     FONT.sm,
      fontFamily:   Poppins.regular,
      color:        t.textSub,
      textAlign:    'center',
      lineHeight:   22,
      marginBottom: 4,
    },
    highlight: {
      fontFamily: Poppins.bold,
      color:      t.accent,
      fontSize:   FONT.md,
    },
    rateBtn: {
      flexDirection:   'row',
      alignItems:      'center',
      justifyContent:  'center',
      gap:             8,
      backgroundColor: t.accent,
      borderRadius:    14,
      paddingVertical: 16,
      alignSelf:       'stretch',
    },
    rateBtnText: {
      fontSize:   FONT.md,
      fontFamily: Poppins.bold,
      color:      '#fff',
    },
    upgradeBtn: {
      alignSelf:       'stretch',
      borderRadius:    14,
      borderWidth:     1,
      borderColor:     t.border,
      paddingVertical: 14,
      alignItems:      'center',
    },
    upgradeBtnText: {
      fontSize:   FONT.sm,
      fontFamily: Poppins.medium,
      color:      t.textSub,
    },
  });
}
