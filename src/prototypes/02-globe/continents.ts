/**
 * Hand-simplified landmass outlines, bundled so the globe never touches the
 * network. Each continent is split into a few chunks — the hexed-polygons
 * layer colours one merged mesh per feature, so chunking is what lets the land
 * read as a two-tone dither instead of one flat slab.
 *
 * Coordinates are [lng, lat] rings, ~10-30 vertices each: recognisable at a
 * glance, deliberately crude up close.
 */

export interface LandGeometry {
  type: 'Polygon';
  coordinates: number[][][];
}

export interface LandFeature {
  type: 'Feature';
  properties: { name: string; region: string; idx: number };
  geometry: LandGeometry;
}

export interface LandCollection {
  type: 'FeatureCollection';
  features: LandFeature[];
}

type Ring = [number, number][];

const RAW: { name: string; region: string; ring: Ring }[] = [
  {
    name: 'North America (north)',
    region: 'americas',
    ring: [
      [-168, 65], [-162, 71], [-140, 70], [-125, 70], [-110, 68], [-95, 68],
      [-80, 70], [-62, 60], [-55, 52], [-67, 45], [-70, 44], [-83, 42],
      [-90, 47], [-95, 49], [-123, 49], [-130, 55], [-140, 60], [-150, 61],
      [-165, 60], [-168, 65],
    ],
  },
  {
    name: 'North America (south)',
    region: 'americas',
    ring: [
      [-125, 49], [-95, 49], [-90, 47], [-83, 42], [-70, 44], [-67, 45],
      [-75, 37], [-81, 31], [-80, 25], [-85, 30], [-94, 29], [-97, 26],
      [-98, 22], [-95, 17], [-92, 15], [-84, 10], [-78, 9], [-83, 15],
      [-88, 21], [-97, 16], [-105, 20], [-110, 24], [-114, 28], [-117, 32],
      [-120, 34], [-124, 40], [-125, 49],
    ],
  },
  {
    name: 'Greenland',
    region: 'americas',
    ring: [
      [-58, 60], [-45, 60], [-22, 70], [-20, 78], [-28, 83], [-45, 84],
      [-62, 80], [-71, 76], [-58, 60],
    ],
  },
  {
    name: 'South America (north)',
    region: 'americas',
    ring: [
      [-81, 8], [-76, 11], [-60, 11], [-52, 5], [-50, 0], [-35, -5],
      [-38, -13], [-45, -20], [-62, -20], [-70, -18], [-75, -14], [-81, -6],
      [-80, 0], [-78, 2], [-81, 8],
    ],
  },
  {
    name: 'South America (south)',
    region: 'americas',
    ring: [
      [-45, -20], [-48, -25], [-58, -34], [-62, -41], [-66, -55], [-72, -52],
      [-73, -45], [-71, -33], [-70, -20], [-62, -20], [-45, -20],
    ],
  },
  {
    name: 'Europe',
    region: 'eurasia',
    ring: [
      [-10, 36], [-9, 44], [-2, 43], [-1, 46], [-4, 48], [2, 51], [4, 53],
      [8, 54], [10, 58], [5, 58], [6, 62], [12, 65], [16, 68], [24, 71],
      [30, 68], [30, 60], [28, 56], [23, 54], [24, 50], [22, 48], [28, 46],
      [29, 41], [23, 40], [19, 40], [14, 38], [16, 41], [12, 44], [8, 44],
      [3, 43], [-2, 37], [-10, 36],
    ],
  },
  {
    name: 'United Kingdom & Ireland',
    region: 'eurasia',
    ring: [
      [-10, 51], [-6, 50], [1, 51], [2, 53], [-1, 56], [-3, 58], [-6, 58],
      [-6, 55], [-10, 55], [-10, 51],
    ],
  },
  {
    name: 'Africa (north)',
    region: 'africa',
    ring: [
      [-17, 15], [-17, 21], [-10, 27], [-5, 32], [0, 36], [10, 37], [11, 34],
      [20, 32], [25, 32], [33, 31], [35, 24], [39, 15], [43, 11], [44, 8],
      [20, 8], [5, 8], [-5, 7], [-13, 9], [-17, 15],
    ],
  },
  {
    name: 'Africa (south)',
    region: 'africa',
    ring: [
      [-5, 7], [5, 8], [20, 8], [44, 8], [51, 12], [48, 5], [41, -2],
      [40, -10], [35, -18], [33, -26], [28, -33], [20, -35], [18, -33],
      [13, -23], [11, -16], [9, -1], [9, 4], [4, 6], [-5, 7],
    ],
  },
  {
    name: 'Madagascar',
    region: 'africa',
    ring: [[43, -12], [50, -15], [50, -25], [45, -25], [43, -19], [43, -12]],
  },
  {
    name: 'Arabia',
    region: 'eurasia',
    ring: [
      [35, 29], [43, 30], [48, 30], [52, 25], [56, 25], [59, 22], [55, 18],
      [52, 16], [45, 13], [43, 13], [39, 17], [35, 24], [35, 29],
    ],
  },
  {
    name: 'Asia (siberia)',
    region: 'eurasia',
    ring: [
      [30, 60], [30, 68], [60, 72], [80, 74], [105, 77], [130, 73], [150, 70],
      [170, 68], [180, 64], [180, 58], [160, 58], [140, 52], [130, 48],
      [115, 48], [100, 48], [85, 48], [70, 48], [58, 50], [48, 50], [38, 52],
      [30, 60],
    ],
  },
  {
    name: 'Asia (south)',
    region: 'eurasia',
    ring: [
      [28, 41], [40, 42], [50, 40], [60, 38], [70, 38], [78, 35], [88, 30],
      [95, 28], [98, 25], [102, 22], [107, 22], [109, 11], [104, 10],
      [100, 13], [98, 8], [94, 18], [90, 22], [87, 21], [80, 9], [76, 8],
      [70, 22], [64, 25], [58, 25], [56, 26], [52, 27], [48, 30], [44, 33],
      [36, 36], [28, 41],
    ],
  },
  {
    name: 'Asia (east)',
    region: 'eurasia',
    ring: [
      [78, 35], [90, 42], [100, 45], [115, 45], [125, 45], [131, 45],
      [130, 40], [126, 38], [122, 32], [118, 25], [112, 21], [107, 22],
      [102, 22], [98, 25], [95, 28], [88, 30], [78, 35],
    ],
  },
  {
    name: 'Japan',
    region: 'eurasia',
    ring: [
      [129, 32], [133, 31], [136, 34], [141, 36], [143, 41], [146, 44],
      [142, 45], [139, 39], [135, 34], [131, 34], [129, 32],
    ],
  },
  {
    name: 'Sunda islands',
    region: 'oceania',
    ring: [
      [95, 6], [97, 3], [103, -3], [106, -7], [114, -9], [119, -9], [120, -5],
      [118, -3], [117, 1], [114, 4], [110, 2], [104, 1], [98, 4], [95, 6],
    ],
  },
  {
    name: 'New Guinea',
    region: 'oceania',
    ring: [[131, -1], [140, -2], [147, -6], [150, -10], [146, -8], [138, -9], [133, -5], [131, -1]],
  },
  {
    name: 'Australia',
    region: 'oceania',
    ring: [
      [114, -22], [113, -26], [115, -34], [118, -35], [125, -32], [131, -31],
      [137, -35], [140, -38], [146, -39], [150, -37], [153, -28], [153, -25],
      [146, -19], [142, -11], [136, -12], [130, -12], [127, -14], [122, -17],
      [114, -22],
    ],
  },
  {
    name: 'New Zealand',
    region: 'oceania',
    ring: [[166, -46], [170, -47], [175, -41], [178, -37], [175, -34], [172, -39], [166, -46]],
  },
  // Antarctica is cut into longitude quadrants: a single ring cannot enclose a
  // pole in lng/lat space, and h3 chokes on rings that span the antimeridian.
  {
    name: 'Antarctica I',
    region: 'antarctic',
    ring: [[-180, -87], [-90, -87], [-90, -68], [-135, -73], [-180, -71], [-180, -87]],
  },
  {
    name: 'Antarctica II',
    region: 'antarctic',
    ring: [[-90, -87], [0, -87], [0, -70], [-45, -76], [-90, -68], [-90, -87]],
  },
  {
    name: 'Antarctica III',
    region: 'antarctic',
    ring: [[0, -87], [90, -87], [90, -66], [45, -68], [0, -70], [0, -87]],
  },
  {
    name: 'Antarctica IV',
    region: 'antarctic',
    ring: [[90, -87], [180, -87], [180, -71], [135, -67], [90, -66], [90, -87]],
  },
];

export const CONTINENTS: LandCollection = {
  type: 'FeatureCollection',
  features: RAW.map((f, idx) => ({
    type: 'Feature' as const,
    properties: { name: f.name, region: f.region, idx },
    geometry: { type: 'Polygon' as const, coordinates: [f.ring.map(([lng, lat]) => [lng, lat])] },
  })),
};

/** Stable per-feature list handed straight to `hexPolygonsData`. */
export const LAND_FEATURES: LandFeature[] = CONTINENTS.features;

/** Cheap string hash so the dither pattern is stable between reloads. */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}

const LAND_A = '#2f6bff'; // electric blue
const LAND_B = '#21c2d6'; // teal

/**
 * Two-tone dither: alternate chunk-to-chunk by index, nudged by a name hash so
 * the pattern is not a strict checkerboard, with a little alpha jitter.
 */
export function landColor(f: LandFeature): string {
  const h = hash(f.properties.name);
  const base = (f.properties.idx + (h > 0.5 ? 1 : 0)) % 2 === 0 ? LAND_A : LAND_B;
  const alpha = 0.72 + Math.round(h * 4) * 0.06; // 0.72 .. 0.96 in pixel steps
  return hexToRgba(base, Math.min(0.96, alpha));
}

function hexToRgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a.toFixed(2)})`;
}
