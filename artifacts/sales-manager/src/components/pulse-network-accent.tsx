import { ConstellationField } from '@designcodeio/threeui/components/ConstellationField';
import { useEffect, useState } from 'react';

type PulseNetworkAccentProps = {
  className?: string;
  compact?: boolean;
};

export function PulseNetworkAccent({ className = '', compact = false }: PulseNetworkAccentProps) {
  const [motionSafe, setMotionSafe] = useState(true);
  const [webglReady, setWebglReady] = useState(false);

  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    const canRender = () => {
      try {
        const canvas = document.createElement('canvas');
        return Boolean(canvas.getContext('webgl') || canvas.getContext('experimental-webgl'));
      } catch {
        return false;
      }
    };
    setMotionSafe(!reduce.matches);
    setWebglReady(canRender());
    const onChange = () => setMotionSafe(!reduce.matches);
    reduce.addEventListener?.('change', onChange);
    return () => reduce.removeEventListener?.('change', onChange);
  }, []);

  return (
    <div className={`pulse-network-accent ${compact ? 'compact' : ''} ${className}`} aria-hidden="true">
      {motionSafe && webglReady ? (
        <ConstellationField
          variant="particle-network"
          mode="light"
          speed={0.28}
          density={0.7}
          opacity={0.55}
          hue={188}
          saturation={0.8}
          brightness={0.9}
          className="pulse-network-canvas"
        />
      ) : (
        <div className="pulse-network-fallback">
          <span /><span /><span /><span /><i /><i /><i />
        </div>
      )}
    </div>
  );
}