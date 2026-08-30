import { generateDataset } from './generate';
export * from './types';
export { DOMAINS, DOMAIN_COLORS } from './generate';

/** Singleton dataset shared by every prototype. */
export const dataset = generateDataset();
export const allEntities = [...dataset.people, ...dataset.projects];

export function entityLabel(e: import('./types').Entity) {
  return e.kind === 'person' ? e.name : e.title;
}
export function entityImage(e: import('./types').Entity) {
  return e.kind === 'person' ? e.avatar : e.cover;
}

/** Euclidean distance in similarity space. */
export function simDistance(a: { pos: { x: number; y: number } }, b: { pos: { x: number; y: number } }) {
  return Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y);
}

/** Great-circle distance in km. */
export function geoDistanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371, toR = (d: number) => (d * Math.PI) / 180;
  const dLat = toR(b.lat - a.lat), dLng = toR(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** "You" — the demo user, in Austin. */
export const me = {
  name: 'You', city: 'Austin', lat: 30.27, lng: -97.74, domain: 'software' as const,
  tags: ['AI/ML', 'civic tech', 'mutual aid'], skills: ['React', 'community organizing'],
  /** similarity-space position: between the software and community anchors */
  pos: { x: 0.72, y: 0.62 },
};
