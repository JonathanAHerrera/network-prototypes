import type { Domain, Person, Project, Dataset, Entity } from './types';

// Deterministic PRNG so every prototype sees identical data.
function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20260827);
const pick = <T,>(arr: T[]) => arr[Math.floor(rand() * arr.length)];
const pickN = <T,>(arr: T[], n: number) => {
  const c = [...arr]; const out: T[] = [];
  while (out.length < n && c.length) out.push(c.splice(Math.floor(rand() * c.length), 1)[0]);
  return out;
};

/**
 * Domains are placed on a ring in similarity space so that neighbours are
 * semantically adjacent (software→robotics→energy→climate→food→community→
 * education→health→art→mobility→software). Entities jitter around their
 * domain's anchor and drift toward secondary-tag domains.
 */
export const DOMAINS: Domain[] = ['software','robotics','energy','climate','food','community','education','health','art','mobility'];
const anchor = (d: Domain) => {
  const i = DOMAINS.indexOf(d);
  const a = (i / DOMAINS.length) * Math.PI * 2;
  return { x: 0.5 + 0.38 * Math.cos(a), y: 0.5 + 0.38 * Math.sin(a) };
};

export const DOMAIN_COLORS: Record<Domain, string> = {
  software: '#4f7cff', robotics: '#7b5cff', energy: '#ffb340', climate: '#37c96c',
  food: '#ff7a59', community: '#ff5fa2', education: '#21c2d6', health: '#ff4d6d',
  art: '#c86bff', mobility: '#2fd0a3',
};

const TAGS: Record<Domain, string[]> = {
  software: ['open source','web apps','AI/ML','data pipelines','devtools','civic tech','mobile apps','APIs'],
  robotics: ['drones','arduino','3D printing','sensors','automation','embedded','computer vision','hardware'],
  energy: ['solar','microgrids','batteries','wind','efficiency','off-grid','EV charging','grid data'],
  climate: ['carbon removal','reforestation','ocean','wildfire','adaptation','policy','biodiversity','soil'],
  food: ['urban farming','food rescue','permaculture','vertical farms','composting','seed saving','nutrition','food deserts'],
  community: ['mutual aid','housing','organizing','co-ops','libraries','refugees','elder care','neighborhoods'],
  education: ['tutoring','coding bootcamps','open courseware','STEM outreach','literacy','maker spaces','mentorship','adult learning'],
  health: ['mental health','telemedicine','accessibility','public health','wearables','clinics','nutrition','mobility aids'],
  art: ['murals','pixel art','music','zines','game jams','film','generative art','theater'],
  mobility: ['bikes','transit','EVs','car repair','walkability','ride share','maps','logistics'],
};
const SKILLS = ['React','Python','Rust','CAD','welding','grant writing','UX design','teaching','data science','electronics','video','community organizing','fundraising','Figma','Unity','Go','GIS','carpentry','Arabic','Spanish','copywriting','product management','nursing','law','accounting'];
const FIRST = ['Amara','Kai','Lucia','Tomás','Priya','Jonas','Mei','Diego','Zara','Elias','Nadia','Rafael','Yuki','Omar','Sofia','Leo','Ines','Arjun','Hana','Mateo','Ada','Noor','Ravi','Ivy','Kofi','Lena','Santi','Esme','Malik','Chloe','Bao','Tariq','Freya','Nico','Wren','Idris','Maya','Otto','Selin','Ezra'];
const LAST = ['Okafor','Nakamura','Reyes','Lindqvist','Sharma','Weber','Chen','Herrera','Haddad','Novak','Silva','Kim','Moreau','Adeyemi','Petrov','Rossi','Kaur','Andersen','Mensah','Torres','Ito','Bakker','Dubois','Osei','Vargas'];
const CITIES: [string,string,number,number][] = [
  ['Austin','USA',30.27,-97.74],['Mexico City','Mexico',19.43,-99.13],['Lagos','Nigeria',6.52,3.38],['Berlin','Germany',52.52,13.40],
  ['Nairobi','Kenya',-1.29,36.82],['São Paulo','Brazil',-23.55,-46.63],['Bangalore','India',12.97,77.59],['Tokyo','Japan',35.68,139.69],
  ['Lisbon','Portugal',38.72,-9.14],['Toronto','Canada',43.65,-79.38],['Jakarta','Indonesia',-6.21,106.85],['Cairo','Egypt',30.04,31.24],
  ['Bogotá','Colombia',4.71,-74.07],['Seoul','South Korea',37.57,126.98],['Amsterdam','Netherlands',52.37,4.90],['Accra','Ghana',5.60,-0.19],
  ['Buenos Aires','Argentina',-34.60,-58.38],['Manila','Philippines',14.60,120.98],['Cape Town','South Africa',-33.92,18.42],['Oslo','Norway',59.91,10.75],
  ['Houston','USA',29.76,-95.37],['San Antonio','USA',29.42,-98.49],['Monterrey','Mexico',25.69,-100.32],['Portland','USA',45.52,-122.68],
];

const PROJECT_TITLES: Record<Domain, string[]> = {
  software: ['OpenGrant','CivicPulse','Volunteer OS','TranslateBridge'],
  robotics: ['SeedBot','ReefDrone','Prosthetic Hand v3','FarmEye'],
  energy: ['SolarShare','Grid Ghost','BatteryLoop','WindWatch'],
  climate: ['Carbon Compass','Mangrove Map','FireLine','Soil Stories'],
  food: ['RootCellar','Plate Rescue','Rooftop Rows','Seed Library'],
  community: ['Block Buddy','Tool Commons','Warm Line','Neighbor Ledger'],
  education: ['CodeCamp Kids','Open Physics','Read Aloud','Maker Bus'],
  health: ['ClinicLink','MindMate','Access Ramp','Pulse Pals'],
  art: ['Mural Grid','Zine Machine','Pixel Parade','Sound Garden'],
  mobility: ['Bike Kitchen','Transit Tracker','Fix-It Garage','WalkScore Local'],
};

function jitter(d: Domain, spread = 0.09) {
  const a = anchor(d);
  const secondary = pick(DOMAINS);
  const b = anchor(secondary);
  const w = rand() * 0.25; // drift toward a secondary domain
  return {
    x: Math.min(0.97, Math.max(0.03, a.x * (1 - w) + b.x * w + (rand() - 0.5) * spread)),
    y: Math.min(0.97, Math.max(0.03, a.y * (1 - w) + b.y * w + (rand() - 0.5) * spread)),
    secondary,
  };
}

function svg(body: string, bg: string) {
  const s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" shape-rendering="crispEdges"><rect width="16" height="16" fill="${bg}"/>${body}</svg>`;
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(s);
}

/** Tamagotchi-style pixel critter: symmetric 8x8 body + eyes + blush. */
function pixelCritter(color: string) {
  let rects = '';
  const eye = pick(['#1b1f3a', '#0a0a0a']);
  for (let y = 3; y < 13; y++) for (let x = 0; x < 8; x++) {
    const on = rand() > 0.42 || (x > 4 && y > 4 && y < 11);
    if (on) rects += `<rect x="${x}" y="${y}" width="1" height="1" fill="${color}"/><rect x="${15 - x}" y="${y}" width="1" height="1" fill="${color}"/>`;
  }
  rects += `<rect x="5" y="7" width="1" height="2" fill="${eye}"/><rect x="10" y="7" width="1" height="2" fill="${eye}"/>`;
  rects += `<rect x="4" y="9" width="1" height="1" fill="#ff8fb1" opacity=".8"/><rect x="11" y="9" width="1" height="1" fill="#ff8fb1" opacity=".8"/>`;
  if (rand() > 0.5) rects += `<rect x="7" y="1" width="2" height="2" fill="${color}"/><rect x="7" y="3" width="2" height="1" fill="#37c96c"/>`;
  return svg(rects, '#fffdf5');
}

function pixelCover(color: string) {
  let rects = '';
  for (let i = 0; i < 26; i++) {
    const x = Math.floor(rand() * 16), y = Math.floor(rand() * 16), s = 1 + Math.floor(rand() * 3);
    rects += `<rect x="${x}" y="${y}" width="${s}" height="${s}" fill="${color}" opacity="${0.4 + rand() * 0.6}"/>`;
  }
  rects += `<rect x="2" y="2" width="12" height="12" fill="none" stroke="${color}" stroke-width="1"/>`;
  return svg(rects, '#0e1030');
}

export function generateDataset(): Dataset {
  const people: Person[] = [];
  const projects: Project[] = [];
  let pid = 0;

  DOMAINS.forEach((domain) => {
    PROJECT_TITLES[domain].forEach((title, i) => {
      const [city, country, lat, lng] = pick(CITIES);
      const { x, y, secondary } = jitter(domain, 0.12);
      const tags = [...pickN(TAGS[domain], 3), pick(TAGS[secondary])];
      const status = (['idea', 'active', 'active', 'launched'] as const)[i % 4];
      projects.push({
        kind: 'project', id: `proj-${String(++pid).padStart(3, '0')}`, title,
        tagline: `${tags[0]} × ${tags[1]} in ${city}`,
        description: `${title} is a ${status} ${domain} project focused on ${tags[0]} and ${tags[1]}. Started in ${city}, it's looking for people who care about ${tags[2]} and can help with ${pick(SKILLS)}.`,
        tags, domain, status, needs: pickN(SKILLS, 3), city, country,
        lat: lat + (rand() - 0.5) * 0.4, lng: lng + (rand() - 0.5) * 0.4,
        pos: { x, y }, cover: pixelCover(DOMAIN_COLORS[domain]), color: DOMAIN_COLORS[domain],
        memberIds: [], activeScore: status === 'active' ? 0.6 + rand() * 0.4 : status === 'launched' ? 0.3 + rand() * 0.4 : rand() * 0.4,
      });
    });
  });

  const usedNames = new Set<string>();
  for (let i = 0; i < 80; i++) {
    const domain = DOMAINS[i % DOMAINS.length];
    let name = `${pick(FIRST)} ${pick(LAST)}`;
    while (usedNames.has(name)) name = `${pick(FIRST)} ${pick(LAST)}`;
    usedNames.add(name);
    const [city, country, lat, lng] = pick(CITIES);
    const { x, y, secondary } = jitter(domain);
    const tags = [...pickN(TAGS[domain], 2), pick(TAGS[secondary])];
    const skills = pickN(SKILLS, 3);
    const domainProjects = projects.filter((p) => p.domain === domain || p.domain === secondary);
    const joined = pickN(domainProjects, 1 + Math.floor(rand() * 2));
    const id = `person-${String(i + 1).padStart(3, '0')}`;
    joined.forEach((p) => p.memberIds.push(id));
    people.push({
      kind: 'person', id, name, handle: '@' + name.toLowerCase().replace(/[^a-z]/g, '').slice(0, 12),
      bio: `${domain[0].toUpperCase() + domain.slice(1)} person in ${city}. Into ${tags[0]} and ${tags[1]}, dabbling in ${tags[2]}. Good at ${skills[0]} and ${skills[1]}.`,
      tags, domain, skills, lookingFor: pick(['collaborators', 'a mentor', 'a project to join', 'people to teach', 'a co-founder', 'weekend hack buddies']),
      city, country, lat: lat + (rand() - 0.5) * 0.4, lng: lng + (rand() - 0.5) * 0.4,
      pos: { x, y }, avatar: pixelCritter(DOMAIN_COLORS[domain]), color: DOMAIN_COLORS[domain],
      projectIds: joined.map((p) => p.id), activeScore: rand(),
    });
  }

  const byId: Record<string, Entity> = {};
  [...people, ...projects].forEach((e) => (byId[e.id] = e));
  return { people, projects, byId, domains: DOMAINS };
}
