'use client';

import { useEffect, useRef, useState } from 'react';
import styles from './DynamicIslandButton.module.css';

// 与 CSS 中 islandPress 动画时长一致，动画结束后再切换页面内容。
const PRESS_MS = 340;

export function DynamicIslandButton({
  title,
  subtitle,
  disabled,
  onPress,
}: {
  title: string;
  subtitle?: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  const [pressed, setPressed] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  return (
    <div className={styles.dock}>
      <button
        type="button"
        className={`${styles.island} ${pressed ? styles.pressed : ''}`}
        disabled={disabled}
        onClick={() => {
          if (pressed) return;
          setPressed(true);
          timer.current = window.setTimeout(onPress, PRESS_MS);
        }}
      >
        <span className={styles.dot} aria-hidden />
        <span className={styles.text}>
          <span className={styles.title}>{title}</span>
          {subtitle ? <span className={styles.subtitle}>{subtitle}</span> : null}
        </span>
        <span className={styles.arrow} aria-hidden>→</span>
      </button>
    </div>
  );
}
