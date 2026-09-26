import { create } from "zustand";
import type { ClipStatus } from "@clipstage/contracts";
export type Section = "library" | "team" | "obs" | "settings";
type UiState = {
  query: string;
  status: ClipStatus | "ALL";
  view: "grid" | "list";
  section: Section;
  setQuery: (value: string) => void;
  setStatus: (value: ClipStatus | "ALL") => void;
  setView: (value: "grid" | "list") => void;
  setSection: (value: Section) => void;
};
// UI preferences only. Auth, server data, and credentials never enter localStorage.
export const useUiStore = create<UiState>((set) => ({
  query: "",
  status: "ALL",
  view: "grid",
  section: "library",
  setQuery: (query) => set({ query }),
  setStatus: (status) => set({ status }),
  setView: (view) => set({ view }),
  setSection: (section) => set({ section }),
}));
