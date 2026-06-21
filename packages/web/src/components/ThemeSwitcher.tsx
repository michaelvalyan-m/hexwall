export type ThemeMode = 'light' | 'system' | 'dark';

const OPTIONS: { mode: ThemeMode; glyph: string; label: string }[] = [
  { mode: 'light', glyph: '☀', label: 'Light' },
  { mode: 'system', glyph: '◐', label: 'System' },
  { mode: 'dark', glyph: '☾', label: 'Dark' },
];

// Floating 3-way theme control. Selection is kept in React state only (no localStorage,
// per the project's core-state rule), so it resets to "system" on reload.
export function ThemeSwitcher({
  mode,
  onChange,
}: {
  mode: ThemeMode;
  onChange: (m: ThemeMode) => void;
}) {
  return (
    <div className="theme-switcher" data-testid="theme-switcher" role="group" aria-label="Color theme">
      {OPTIONS.map((o) => (
        <button
          key={o.mode}
          className="theme-btn"
          data-testid={`theme-${o.mode}`}
          data-active={mode === o.mode}
          aria-pressed={mode === o.mode}
          title={`${o.label} theme`}
          onClick={() => onChange(o.mode)}
        >
          <span aria-hidden="true">{o.glyph}</span>
          <span className="theme-label">{o.label}</span>
        </button>
      ))}
    </div>
  );
}
