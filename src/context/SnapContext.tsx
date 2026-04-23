import React, { createContext, useContext, useState } from 'react';
import { SnapGuide } from '../utils/snap';

interface SnapContextValue {
  guides: SnapGuide[];
  setGuides: (g: SnapGuide[]) => void;
}

const SnapContext = createContext<SnapContextValue>({ guides: [], setGuides: () => {} });

export function SnapProvider({ children }: { children: React.ReactNode }) {
  const [guides, setGuides] = useState<SnapGuide[]>([]);
  return <SnapContext.Provider value={{ guides, setGuides }}>{children}</SnapContext.Provider>;
}

export function useSnapGuides() { return useContext(SnapContext); }
