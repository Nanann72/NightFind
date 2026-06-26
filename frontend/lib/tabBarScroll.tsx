/**
 * Tab bar auto-hide / show on scroll context.
 *
 * Screens push their scroll delta to `tabBarVisible` (SharedValue 0..1).
 * The LiquidGlassTabBar listens to this value and animates its
 * translateY to slide off-screen when the user scrolls DOWN
 * and back on when scrolling UP — same behavior as Safari/Instagram.
 */
import React, { createContext, useContext, useRef } from 'react';
import { useSharedValue, SharedValue, withSpring } from 'react-native-reanimated';
import { motion } from './theme';

interface TabBarScrollCtx {
  /** 1 = fully visible, 0 = fully hidden */
  tabBarVisible: SharedValue<number>;
  /** Convenience hook called by screens from their onScroll handler */
  onScroll: (deltaY: number) => void;
  show: () => void;
  hide: () => void;
}

const Ctx = createContext<TabBarScrollCtx | null>(null);

export function TabBarScrollProvider({ children }: { children: React.ReactNode }) {
  const tabBarVisible = useSharedValue(1);
  const lastY = useRef(0);
  const accumDown = useRef(0);
  const accumUp = useRef(0);

  const show = () => {
    'worklet';
    tabBarVisible.value = withSpring(1, motion.spring.smooth);
  };
  const hide = () => {
    'worklet';
    tabBarVisible.value = withSpring(0, motion.spring.smooth);
  };

  const onScroll = (y: number) => {
    const delta = y - lastY.current;
    lastY.current = y;
    // Always show near top
    if (y < 32) {
      accumDown.current = 0;
      accumUp.current = 0;
      if (tabBarVisible.value !== 1) tabBarVisible.value = withSpring(1, motion.spring.smooth);
      return;
    }
    if (delta > 0) {
      accumUp.current = 0;
      accumDown.current += delta;
      if (accumDown.current > 24 && tabBarVisible.value !== 0) {
        tabBarVisible.value = withSpring(0, motion.spring.smooth);
      }
    } else if (delta < 0) {
      accumDown.current = 0;
      accumUp.current += -delta;
      if (accumUp.current > 12 && tabBarVisible.value !== 1) {
        tabBarVisible.value = withSpring(1, motion.spring.smooth);
      }
    }
  };

  return (
    <Ctx.Provider value={{ tabBarVisible, onScroll, show, hide }}>{children}</Ctx.Provider>
  );
}

export function useTabBarScroll(): TabBarScrollCtx {
  const ctx = useContext(Ctx);
  if (!ctx) {
    // Safe fallback if used outside provider
    const fallback = useSharedValue(1);
    return {
      tabBarVisible: fallback,
      onScroll: () => {},
      show: () => {},
      hide: () => {},
    };
  }
  return ctx;
}
