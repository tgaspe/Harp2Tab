import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useTheme } from '@/hooks/useTheme';

interface PulsingIndicatorProps {
  size?: number;
  active: boolean;
}

/** Sonar-pulse recording indicator — two staggered expanding rings + inner solid circle */
export function PulsingIndicator({ size = 160, active }: PulsingIndicatorProps) {
  const theme = useTheme();
  const color = active ? theme.record : theme.surfaceAlt;

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <PulseRing size={size} color={color} active={active} delay={0} />
      <PulseRing size={size} color={color} active={active} delay={500} />

      {/* Inner solid circle */}
      <View
        style={[
          styles.inner,
          {
            width:  size * 0.55,
            height: size * 0.55,
            borderRadius: (size * 0.55) / 2,
            backgroundColor: color,
          },
        ]}
      />
    </View>
  );
}

interface PulseRingProps {
  size: number;
  color: string;
  active: boolean;
  delay: number;
}

function PulseRing({ size, color, active, delay }: PulseRingProps) {
  const scale   = useSharedValue(0.6);
  const opacity = useSharedValue(0);

  useEffect(() => {
    if (!active) {
      scale.value   = withTiming(0.6, { duration: 400 });
      opacity.value = withTiming(0,   { duration: 400 });
      return;
    }

    const animate = () => {
      scale.value = withRepeat(
        withSequence(
          withTiming(0.6, { duration: delay, easing: Easing.linear }),
          withTiming(1.2, { duration: 1400,  easing: Easing.out(Easing.cubic) }),
          withTiming(0.6, { duration: 0 }),
        ),
        -1,
        false,
      );
      opacity.value = withRepeat(
        withSequence(
          withTiming(0.55, { duration: delay }),
          withTiming(0,    { duration: 1400, easing: Easing.out(Easing.quad) }),
          withTiming(0.55, { duration: 0 }),
        ),
        -1,
        false,
      );
    };

    animate();
  }, [active, delay, scale, opacity]);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity:   opacity.value,
  }));

  return (
    <Animated.View
      style={[
        styles.ring,
        {
          width:        size,
          height:       size,
          borderRadius: size / 2,
          borderColor:  color,
        },
        animStyle,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  ring: {
    position:    'absolute',
    borderWidth: 1.5,
  },
  inner: {
    position: 'absolute',
  },
});
