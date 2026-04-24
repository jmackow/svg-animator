import React, { useState, useRef, useEffect } from 'react';
import { useTheme, Theme } from '../context/ThemeContext';
import { Palette } from '@phosphor-icons/react';

const THEMES: { id: Theme; label: string; description: string }[] = [
  { id: 'boring', label: 'Boring', description: 'Modern dark theme' },
  { id: 'og', label: 'OG', description: 'Windows 2000 classic' },
  { id: 'luna', label: 'Luna', description: 'Windows XP style' },
  { id: 'classic-mac', label: 'Classic Mac', description: 'Macintosh System 7' },
  { id: 'nothing', label: 'Nothing', description: 'Nothing OS style' },
];

export default function ThemePicker() {
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const currentTheme = THEMES.find(t => t.id === theme)!;

  return (
    <div className="theme-picker" ref={ref}>
      <button
        className="theme-picker-trigger"
        onClick={() => setOpen(!open)}
        title={`Theme: ${currentTheme.label}`}
      >
        <Palette size={16} weight="fill" />
      </button>
      {open && (
        <div className="theme-picker-dropdown">
          <div className="theme-picker-header">Theme</div>
          {THEMES.map(t => (
            <button
              key={t.id}
              className={`theme-picker-option ${theme === t.id ? 'theme-picker-option--active' : ''}`}
              onClick={() => {
                setTheme(t.id);
                setOpen(false);
              }}
            >
              <span className="theme-picker-option-label">{t.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
