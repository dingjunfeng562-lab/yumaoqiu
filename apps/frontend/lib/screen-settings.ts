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

/** Size of the board area the screen has to work with, in CSS pixels. */
export type BoardViewport = { width: number; height: number };

/** Card size used when a saved setting predates these fields or omits them. */
export const DEFAULT_CARD_WIDTH = 560;
export const LARGE_SCREEN_CARD_WIDTH = 770;
export const LARGE_SCREEN_CARD_HEIGHT = 495;
export const LARGE_SCREEN_CARD_FONT_SCALE = 150;
/**
 * Multiplier applied to every font on the big screen, on top of the per
 * tournament card font size. Raising this enlarges all screen text at once,
 * including tournaments whose saved font size already sits at the ceiling.
 */
export const SCREEN_FONT_BOOST = 1.1;
export const DEFAULT_CARD_HEIGHT = 360;
/** Widest row the settings API accepts; mirrors the backend DTO. */
export const MAX_SCREEN_COLUMNS = 8;
/** Gap between courts. Only used until the real gap can be measured. */
const BOARD_GAP = 20;

/**
 * Row count for a given row width. Every venue always gets a cell: the board
 * grows downwards rather than dropping, paging or hiding what no longer fits.
 */
export function boardRows(count: number, columns: number) {
  return Math.max(1, Math.ceil(Math.max(0, count) / Math.max(1, columns)));
}

export function screenCardWidth(count: number, settings?: ScreenSettings | null) {
  const configured = settings?.cardWidth;
  // Upgrade former defaults for a crowded board, while preserving deliberate custom sizes.
  if (count > 6 && (configured === undefined || configured === DEFAULT_CARD_WIDTH || configured === 620 || configured === 700)) return LARGE_SCREEN_CARD_WIDTH;
  return configured ?? DEFAULT_CARD_WIDTH;
}

export function screenCardHeight(count: number, settings?: ScreenSettings | null) {
  const configured = settings?.cardHeight;
  if (count > 6 && (configured === undefined || configured === DEFAULT_CARD_HEIGHT || configured === 450)) return LARGE_SCREEN_CARD_HEIGHT;
  return configured ?? DEFAULT_CARD_HEIGHT;
}

export function screenCardFontScale(count: number, settings?: ScreenSettings | null) {
  const configured = settings?.cardFontScale;
  // 100/110/120/140 are former defaults; 160 was the former ceiling, so a screen
  // saved at exactly 160 was asking for "as large as allowed" and moves up a notch.
  if (count > 6 && (configured === undefined || [100, 110, 120, 140].includes(configured))) return LARGE_SCREEN_CARD_FONT_SCALE;
  if (count > 6 && configured === 160) return 170;
  return configured ?? 100;
}

/** Board size in CSS pixels when `count` venues are laid out `columns` wide. */
export function boardSize(count: number, columns: number, settings?: ScreenSettings | null) {
  const rows = boardRows(count, columns);
  const cardWidth = screenCardWidth(count, settings);
  const cardHeight = screenCardHeight(count, settings);
  return {
    columns, rows,
    width: columns * cardWidth + (columns - 1) * BOARD_GAP,
    height: rows * cardHeight + (rows - 1) * BOARD_GAP,
  };
}

/**
 * Zoom the whole board can use when courts are laid out `columns` wide. The
 * board is never cropped, so this is the largest scale that still shows every
 * court at once.
 */
export function boardScale(count: number, columns: number, settings: ScreenSettings | null | undefined, viewport?: BoardViewport | null) {
  const requested = (settings?.scale ?? 100) / 100;
  if (!viewport || viewport.width <= 0 || viewport.height <= 0) return requested;
  const board = boardSize(count, columns, settings);
  return Math.min(requested, viewport.width / board.width, viewport.height / board.height);
}

/**
 * Resolves the board grid for `count` venues.
 *
 * `settings.columns` ("每行最多场地数") is an upper bound. Within that bound the
 * arrangement that renders the courts largest wins, so a tournament with many
 * courts uses the long edge of the display instead of collapsing into a narrow
 * strip of tiny cards. Whatever the outcome, every venue gets a cell and the
 * board is scaled as a whole — the venue count can never make a court disappear.
 */
export function screenLayout(count: number, settings?: ScreenSettings | null, viewport?: BoardViewport | null) {
  if (count <= 0) return { columns: 1, rows: 1 };
  const maxColumns = Math.max(1, Math.min(MAX_SCREEN_COLUMNS, settings?.columns ?? MAX_SCREEN_COLUMNS));
  // Nothing to optimise before the first measurement: keep the configured
  // shape, or the shape implied by the venue count.
  if (!viewport || viewport.width <= 0 || viewport.height <= 0) {
    const columns = settings
      ? Math.max(1, Math.min(maxColumns, Math.ceil(count / Math.max(1, settings.rows))))
      : Math.min(maxColumns, defaultScreenColumns(count));
    return { columns, rows: boardRows(count, columns) };
  }
  let columns = 1;
  let bestScale = -1;
  for (let candidate = 1; candidate <= maxColumns; candidate++) {
    const scale = boardScale(count, candidate, settings, viewport);
    // Ties keep the wider row: it uses the long edge of the display.
    if (scale >= bestScale) { bestScale = scale; columns = candidate; }
  }
  return { columns, rows: boardRows(count, columns) };
}

export function defaultScreenColumns(count: number) {
  return count <= 3 ? Math.max(count, 1) : count <= 6 ? 3 : 4;
}

export function defaultScreenSettings(count: number, viewport?: BoardViewport | null): ScreenSettings {
  const { columns, rows } = screenLayout(count, null, viewport);
  return { columns, rows, scale: 100, titleFontSize: 48, cardWidth: screenCardWidth(count), cardHeight: screenCardHeight(count), boundaryPadding: 0, cardFontScale: 100 };
}

export function readLocalScreenSettings(id: string): ScreenSettings | null {
  if (typeof window === 'undefined') return null;
  try {
    const value = JSON.parse(localStorage.getItem(`tournament-screen:${id}`) ?? 'null');
    if (!value || !['columns', 'rows', 'scale', 'titleFontSize'].every((key) => Number.isInteger(value[key]))) return null;
    if (value.columns < 1 || value.columns > MAX_SCREEN_COLUMNS || value.rows < 1 || value.rows > MAX_SCREEN_COLUMNS ||
      value.scale < 50 || value.scale > 200 || value.titleFontSize < 20 || value.titleFontSize > 120) return null;
    if (value.cardWidth !== undefined && (!Number.isInteger(value.cardWidth) || value.cardWidth < 240 || value.cardWidth > 1200)) return null;
    if (value.cardHeight !== undefined && (!Number.isInteger(value.cardHeight) || value.cardHeight < 160 || value.cardHeight > 900)) return null;
    if (value.boundaryPadding !== undefined && (!Number.isInteger(value.boundaryPadding) || value.boundaryPadding < 0 || value.boundaryPadding > 160)) return null;
    if (value.cardFontScale !== undefined && (!Number.isInteger(value.cardFontScale) || value.cardFontScale < 50 || value.cardFontScale > 200)) return null;
    return value as ScreenSettings;
  } catch { return null; }
}
