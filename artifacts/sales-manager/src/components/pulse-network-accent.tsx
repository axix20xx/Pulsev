import { lazy, Suspense, useEffect, useState } from 'react';
import '@designcodeio/threeui/style.css';

const LazyConstellationField = lazy(() =>
  import('@designcodeio/threeui/components/ConstellationField').then((module) => ({
    default: module.ConstellationField,
  })),
);

type PulseNetworkAccentProps = {
  className?: string;
  compact?: boolean;
};

export function PulseNetworkAccent({ className = '', compact = false }: PulseNetworkAccentProps) {
  const [motionSafe, setMotionSafe] = useState(true);
  const [webglReady, setWebglReady] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    const mobile = window.matchMedia('(max-width: 768px)');
    
    const canRender = () => {
      const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
      // Do not block mobile entirely, but block low cores and save-data
      if (
        connection?.saveData ||
        (navigator.hardwareConcurrency || 4) < 4
      ) return false;
      try {
        const canvas = document.createElement('canvas');
        return Boolean(canvas.getContext('webgl') || canvas.getContext('experimental-webgl'));
      } catch {
        return false;
      }
    };
    
    setMotionSafe(!reduce.matches);
    setIsMobile(mobile.matches);
    setWebglReady(canRender());
    
    const onChangeReduce = () => setMotionSafe(!reduce.matches);
    const onChangeMobile = () => setIsMobile(mobile.matches);
    
    reduce.addEventListener?.('change', onChangeReduce);
    mobile.addEventListener?.('change', onChangeMobile);
    
    return () => {
      reduce.removeEventListener?.('change', onChangeReduce);
      mobile.removeEventListener?.('change', onChangeMobile);
    };
  }, []);

  // Compute colors based on theme if needed, but here we hardcode to a deep rich teal 
  // that aligns with our CSS variables (--primary: 193 84% 32%).
  
  return (
    <div className={`pulse-network-accent absolute inset-0 overflow-hidden pointer-events-none ${compact ? 'compact' : ''} ${className}`} aria-hidden="true" style={{ opacity: 0.6 }}>
      {motionSafe && webglReady ? (
        <Suspense fallback={<div className="pulse-network-fallback absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent"></div>}>
          <LazyConstellationField
            variant="particle-network"
            mode="dark" // Using dark mode for the field for high contrast dots even in light theme, or adjust based on actual design
            speed={isMobile ? 0.15 : 0.2}
            density={isMobile ? 0.3 : (compact ? 0.4 : 0.7)}
            opacity={0.8}
            hue={193}
            saturation={0.9}
            brightness={1.5}
            className="pulse-network-canvas w-full h-full"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-background via-background/40 to-transparent pointer-events-none" />
        </Suspense>
      ) : (
        <div className="pulse-network-fallback absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent"></div>
      )}
    </div>
  );
}
