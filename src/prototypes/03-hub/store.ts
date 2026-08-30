import { create } from 'zustand';
import { search, type SearchResult } from '../../shared/ai';

export type HubView = 'hub' | 'graph' | 'map';

/** Queries that should open the world map instead of the graph. */
export const NEARBY_RE = /near me|nearby|local|around here|close to me|\bin [a-z]+$/i;

export interface HubState {
  view: HubView;
  query: string;
  result: SearchResult | null;
  busy: boolean;
  error: string | null;
  selectedId: string | null;
  setSelected: (id: string | null) => void;
  runSearch: (q: string) => Promise<void>;
  goHome: () => void;
}

export const useHub = create<HubState>((set) => ({
  view: 'hub',
  query: '',
  result: null,
  busy: false,
  error: null,
  selectedId: null,

  setSelected: (id) => set({ selectedId: id }),

  runSearch: async (q) => {
    const query = q.trim();
    if (!query) return;
    set({ busy: true, error: null, query, selectedId: null });
    try {
      const result = await search(query, { limit: 12 });
      const wantsMap = result.intent === 'nearby' || NEARBY_RE.test(query);
      set({ result, busy: false, view: wantsMap ? 'map' : 'graph' });
    } catch (e) {
      set({
        busy: false,
        error: e instanceof Error ? e.message : 'search failed',
        view: 'graph',
        result: null,
      });
    }
  },

  goHome: () => set({ view: 'hub', selectedId: null, error: null }),
}));
