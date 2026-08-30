export type Domain =
  | 'climate' | 'education' | 'health' | 'robotics' | 'software'
  | 'community' | 'food' | 'energy' | 'art' | 'mobility';

export interface Person {
  kind: 'person';
  id: string;
  name: string;
  handle: string;
  bio: string;
  tags: string[];
  domain: Domain;
  skills: string[];
  lookingFor: string;
  city: string;
  country: string;
  lat: number;
  lng: number;
  /** 2D similarity-space coordinate in [0,1]^2. Nearby = similar interests. */
  pos: { x: number; y: number };
  avatar: string; // data:image/svg+xml
  color: string;
  projectIds: string[];
  activeScore: number; // 0..1
}

export interface Project {
  kind: 'project';
  id: string;
  title: string;
  tagline: string;
  description: string;
  tags: string[];
  domain: Domain;
  status: 'idea' | 'active' | 'launched';
  needs: string[];
  city: string;
  country: string;
  lat: number;
  lng: number;
  pos: { x: number; y: number };
  cover: string; // data:image/svg+xml
  color: string;
  memberIds: string[];
  activeScore: number;
}

export type Entity = Person | Project;

export interface Dataset {
  people: Person[];
  projects: Project[];
  /** id -> entity */
  byId: Record<string, Entity>;
  domains: Domain[];
}
