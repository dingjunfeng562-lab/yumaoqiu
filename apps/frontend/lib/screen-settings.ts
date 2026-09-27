export type ScreenSettings = {
  columns: number;
  rows: number;
  scale: number;
  titleFontSize: number;
  cardWidth?: number;
  cardHeight?: number;
  boundaryPadding?: number;
  cardFontScale?: number;
};

export function screenLayout(count: number, settings?: ScreenSettings | null) {
  const maxColumns = settings?.columns ?? (count <= 3 ? Math.max(count, 1) : count <= 6 ? 3 : 4);
  const columns = settings ? Math.min(maxColumns, Math.max(1, Math.ceil(count / settings.rows))) : maxColumns;
  return { columns, rows: Math.max(1, Math.ceil(count / columns)) };
}

export function defaultScreenSettings(count: number): ScreenSettings {
  const columns = count <= 3 ? Math.max(count, 1) : count <= 6 ? 3 : 4;
  return { columns, rows: Math.min(8, Math.max(1, Math.ceil(count / columns))), scale: 100, titleFontSize: 48, cardWidth: 560, cardHeight: 360, boundaryPadding: 28, cardFontScale: 100 };
}

export function readLocalScreenSettings(id: string): ScreenSettings | null {
  if (typeof window === 'undefined') return null;
  try {
    const value = JSON.parse(localStorage.getItem(`tournament-screen:${id}`) ?? 'null');
    if (!value || !['columns', 'rows', 'scale', 'titleFontSize'].every((key) => Number.isInteger(value[key]))) return null;
    if (value.columns < 1 || value.columns > 8 || value.rows < 1 || value.rows > 8 ||
      value.scale < 50 || value.scale > 200 || value.titleFontSize < 20 || value.titleFontSize > 120) return null;
    if (value.cardWidth !== undefined && (!Number.isInteger(value.cardWidth) || value.cardWidth < 240 || value.cardWidth > 1200)) return null;
    if (value.cardHeight !== undefined && (!Number.isInteger(value.cardHeight) || value.cardHeight < 160 || value.cardHeight > 900)) return null;
    if (value.boundaryPadding !== undefined && (!Number.isInteger(value.boundaryPadding) || value.boundaryPadding < 0 || value.boundaryPadding > 160)) return null;
    if (value.cardFontScale !== undefined && (!Number.isInteger(value.cardFontScale) || value.cardFontScale < 50 || value.cardFontScale > 160)) return null;
    return value as ScreenSettings;
  } catch { return null; }
}
