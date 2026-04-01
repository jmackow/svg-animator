import { EasingConfig, EasingPreset } from '../types';

// ─── Cubic Bezier ─────────────────────────────────────────────────────────────

const PRESET_PARAMS: Record<EasingPreset, [number, number, number, number]> = {
  linear:       [0,    0,    1,    1   ],
  ease:         [0.25, 0.1,  0.25, 1.0 ],
  'ease-in':    [0.42, 0,    1.0,  1.0 ],
  'ease-out':   [0,    0,    0.58, 1.0 ],
  'ease-in-out':[0.42, 0,    0.58, 1.0 ],
};

function cubicBezierFn(x1: number, y1: number, x2: number, y2: number) {
  return (t: number): number => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    // Newton-Raphson: find u such that X(u) = t
    let u = t;
    for (let i = 0; i < 10; i++) {
      const xU = 3*(1-u)*(1-u)*u*x1 + 3*(1-u)*u*u*x2 + u*u*u;
      const dxU = 3*(1-u)*(1-u)*x1 + 6*(1-u)*u*(x2-x1) + 3*u*u*(1-x2);
      if (Math.abs(dxU) < 1e-8) break;
      u -= (xU - t) / dxU;
    }
    return 3*(1-u)*(1-u)*u*y1 + 3*(1-u)*u*u*y2 + u*u*u;
  };
}

// ─── Spring physics ───────────────────────────────────────────────────────────

/** Simulate spring position at time t (seconds). Returns ~0 at t=0, ~1 as t→∞. */
export function simulateSpring(stiffness: number, damping: number, mass: number, t: number): number {
  if (t <= 0) return 0;
  const k = stiffness, c = damping, m = mass;
  const wn = Math.sqrt(k / m);
  const zeta = c / (2 * Math.sqrt(k * m));

  if (zeta < 1 - 1e-7) {
    // Underdamped — oscillates
    const wd = wn * Math.sqrt(1 - zeta * zeta);
    const B = (zeta * wn) / wd;
    return 1 - Math.exp(-zeta * wn * t) * (Math.cos(wd * t) + B * Math.sin(wd * t));
  } else if (zeta > 1 + 1e-7) {
    // Overdamped — no oscillation
    const s = Math.sqrt(zeta * zeta - 1);
    const r1 = wn * (-zeta + s);
    const r2 = wn * (-zeta - s);
    return 1 + (r2 / (r1 - r2)) * Math.exp(r1 * t) - (r1 / (r1 - r2)) * Math.exp(r2 * t);
  } else {
    // Critically damped
    return 1 - Math.exp(-wn * t) * (1 + wn * t);
  }
}

/** Time (seconds) for spring to settle within `threshold` of target. */
export function springSettlingTime(
  stiffness: number, damping: number, mass: number, threshold = 0.005
): number {
  const k = stiffness, c = damping, m = mass;
  const wn = Math.sqrt(k / m);
  const zeta = c / (2 * Math.sqrt(k * m));

  if (zeta < 1 - 1e-7) {
    const wd = wn * Math.sqrt(1 - zeta * zeta);
    const B = (zeta * wn) / wd;
    const amplitude = Math.sqrt(1 + B * B);
    const t = Math.log(amplitude / threshold) / (zeta * wn);
    return Math.max(t, 0.05);
  }
  // Critically / overdamped: rough estimate
  return Math.max((Math.log(1 / threshold) + 1) / wn, 0.05);
}

// ─── Evaluate EasingConfig → [0,1]→[0,~1] ────────────────────────────────────

export function evaluateEasing(config: EasingConfig, t: number): number {
  switch (config.type) {
    case 'preset': {
      const [x1, y1, x2, y2] = PRESET_PARAMS[config.name];
      return cubicBezierFn(x1, y1, x2, y2)(t);
    }
    case 'bezier':
      return cubicBezierFn(config.x1, config.y1, config.x2, config.y2)(t);
    case 'spring': {
      const dur = springSettlingTime(config.stiffness, config.damping, config.mass);
      return simulateSpring(config.stiffness, config.damping, config.mass, t * dur);
    }
  }
}

// ─── CSS representation for export ───────────────────────────────────────────

export function easingToCss(config: EasingConfig): string {
  switch (config.type) {
    case 'preset':
      return config.name;
    case 'bezier':
      return `cubic-bezier(${config.x1}, ${config.y1}, ${config.x2}, ${config.y2})`;
    case 'spring': {
      // Approximate as CSS linear() with sample points
      const SAMPLES = 50;
      const dur = springSettlingTime(config.stiffness, config.damping, config.mass);
      const pts = Array.from({ length: SAMPLES + 1 }, (_, i) => {
        const t = i / SAMPLES;
        return simulateSpring(config.stiffness, config.damping, config.mass, t * dur).toFixed(5);
      });
      return `linear(${pts.join(', ')})`;
    }
  }
}

// ─── SVG polyline points for curve preview ────────────────────────────────────

export function curvePoints(config: EasingConfig, w: number, h: number, n = 60): string {
  const samples = Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n;
    return [t, evaluateEasing(config, t)] as [number, number];
  });

  const ys = samples.map(([, y]) => y);
  const minY = Math.min(0, ...ys);
  const maxY = Math.max(1, ...ys);
  const rangeY = maxY - minY || 1;
  const padY = h * 0.06;
  const usableH = h - padY * 2;

  return samples
    .map(([t, v]) => {
      const x = t * w;
      const y = padY + (1 - (v - minY) / rangeY) * usableH;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');
}

export function easingLabel(config: EasingConfig): string {
  switch (config.type) {
    case 'preset': {
      const map: Record<EasingPreset, string> = {
        linear: 'Linear', ease: 'Ease', 'ease-in': 'Ease In',
        'ease-out': 'Ease Out', 'ease-in-out': 'Ease In-Out',
      };
      return map[config.name];
    }
    case 'bezier': return 'Custom Bezier';
    case 'spring': return 'Spring';
  }
}
