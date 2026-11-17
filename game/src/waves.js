// LANTERNFALL — the 15 waves.
// Each wave is a list of spawn groups: {kind, count, interval, delay}, where
// delay is seconds after the wave starts before the group begins. Intervals
// tighten and the mix thickens as the waves rise; boss waves (5, 10, 15)
// carry one wraith plus escorts, and swarmlings swarm from wave 6 on.
// Wave 1 is deliberately gentle: 8 wisps, one ember spire clears it.

export function waveSpec(wave) {
  switch (wave) {
    case 1:
      return [{ kind: 'wisp', count: 8, interval: 1.2, delay: 0 }];
    case 2:
      return [{ kind: 'wisp', count: 12, interval: 1.0, delay: 0 }];
    case 3:
      return [
        { kind: 'wisp', count: 10, interval: 0.9, delay: 0 },
        { kind: 'shade', count: 5, interval: 1.4, delay: 4 },
      ];
    case 4:
      return [
        { kind: 'shade', count: 8, interval: 1.0, delay: 0 },
        { kind: 'wisp', count: 8, interval: 0.8, delay: 6 },
      ];
    case 5:
      return [
        { kind: 'wraith', count: 1, interval: 1, delay: 0 },
        { kind: 'wisp', count: 2, interval: 1.0, delay: 4 },
        { kind: 'shade', count: 2, interval: 1.2, delay: 14 },
      ];
    case 6:
      return [
        { kind: 'swarmling', count: 18, interval: 0.5, delay: 0 },
        { kind: 'wisp', count: 6, interval: 0.9, delay: 5 },
      ];
    case 7:
      return [
        { kind: 'shade', count: 10, interval: 0.9, delay: 0 },
        { kind: 'swarmling', count: 10, interval: 0.4, delay: 4 },
      ];
    case 8:
      return [
        { kind: 'brute', count: 6, interval: 1.6, delay: 0 },
        { kind: 'wisp', count: 10, interval: 0.7, delay: 5 },
      ];
    case 9:
      return [
        { kind: 'shade', count: 14, interval: 0.8, delay: 0 },
        { kind: 'swarmling', count: 12, interval: 0.35, delay: 4 },
      ];
    case 10:
      return [
        { kind: 'wraith', count: 1, interval: 1, delay: 0 },
        { kind: 'shade', count: 8, interval: 1.0, delay: 3 },
        { kind: 'swarmling', count: 12, interval: 0.4, delay: 7 },
        { kind: 'brute', count: 4, interval: 1.8, delay: 12 },
      ];
    case 11:
      return [
        { kind: 'brute', count: 8, interval: 1.4, delay: 0 },
        { kind: 'wisp', count: 16, interval: 0.6, delay: 5 },
      ];
    case 12:
      return [
        { kind: 'swarmling', count: 24, interval: 0.35, delay: 0 },
        { kind: 'shade', count: 12, interval: 0.7, delay: 4 },
      ];
    case 13:
      return [
        { kind: 'shade', count: 12, interval: 0.7, delay: 0 },
        { kind: 'brute', count: 8, interval: 1.3, delay: 4 },
        { kind: 'wisp', count: 10, interval: 0.6, delay: 8 },
      ];
    case 14:
      return [
        { kind: 'wisp', count: 16, interval: 0.5, delay: 0 },
        { kind: 'brute', count: 9, interval: 1.2, delay: 3 },
        { kind: 'swarmling', count: 16, interval: 0.3, delay: 7 },
      ];
    case 15:
      return [
        { kind: 'wraith', count: 1, interval: 1, delay: 0 },
        { kind: 'shade', count: 10, interval: 0.8, delay: 3 },
        { kind: 'brute', count: 8, interval: 1.2, delay: 8 },
        { kind: 'swarmling', count: 20, interval: 0.3, delay: 12 },
      ];
    default:
      return [];
  }
}

export function waveTotalEnemies(spec) {
  return spec.reduce((total, group) => total + group.count, 0);
}
