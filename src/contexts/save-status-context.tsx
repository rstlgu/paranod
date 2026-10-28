'use client';

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  useEffect
} from 'react';

interface SaveStatusContextType {
  isSaving: boolean;
  lastSaved: Date | null;
  isInGraphPage: boolean;
  setSaving: (saving: boolean) => void;
  setLastSaved: (date: Date | null) => void;
  setIsInGraphPage: (inGraph: boolean) => void;
  triggerManualSave: () => void;
}

const SaveStatusContext = createContext<SaveStatusContextType | null>(null);

export function SaveStatusProvider({
  children
}: {
  children: React.ReactNode;
}) {
  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSavedState] = useState<Date | null>(null);
  const [isInGraphPage, setIsInGraphPageState] = useState(false);
  const manualSaveCallback = useRef<(() => void) | null>(null);

  const setSaving = useCallback((saving: boolean) => {
    setIsSaving(saving);
  }, []);

  const setLastSaved = useCallback((date: Date | null) => {
    setLastSavedState(date);
  }, []);

  const setIsInGraphPage = useCallback((inGraph: boolean) => {
    setIsInGraphPageState(inGraph);
    // Reset stati quando esci dalla pagina del grafo
    if (!inGraph) {
      setIsSaving(false);
      setLastSavedState(null);
      manualSaveCallback.current = null;
    }
  }, []);

  const triggerManualSave = useCallback(() => {
    if (manualSaveCallback.current) {
      manualSaveCallback.current();
    }
  }, []);

  return (
    <SaveStatusContext.Provider
      value={{
        isSaving,
        lastSaved,
        isInGraphPage,
        setSaving,
        setLastSaved,
        setIsInGraphPage,
        triggerManualSave
      }}
    >
      {children}
    </SaveStatusContext.Provider>
  );
}

export function useSaveStatus() {
  const context = useContext(SaveStatusContext);
  return context;
}

// Hook per registrare la callback di salvataggio manuale
export function useRegisterManualSave(callback: () => void) {
  const context = useContext(SaveStatusContext);

  useEffect(() => {
    if (context) {
      // @ts-ignore - accesso interno
      context.manualSaveCallback = { current: callback };
    }
    return () => {
      if (context) {
        // @ts-ignore
        context.manualSaveCallback = { current: null };
      }
    };
  }, [callback, context]);
}
