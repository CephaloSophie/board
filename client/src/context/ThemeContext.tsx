import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Theme } from '../types';

const STORAGE_KEY = 'board.theme';
const THEMES: Theme[] = ['dark', 'light', 'ubuntu', 'mac'];

interface ThemeContextValue {
  theme: Theme;
  setTheme: (t: Theme) => void;
  themes: Theme[];
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    const stored = localStorage.getItem(STORAGE_KEY) as Theme | null;
    return stored && THEMES.includes(stored) ? stored : 'dark';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme: setThemeState, themes: THEMES }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
