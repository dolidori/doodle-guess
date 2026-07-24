import {
  PALETTE,
  STROKE_WIDTHS,
  type PaletteColor,
  type StrokeTool,
  type StrokeWidth
} from '../../../../shared/src/index.js';

export type ToolSettings = {
  tool: StrokeTool;
  color: PaletteColor;
  width: StrokeWidth;
};

const WIDTH_LABELS: Record<StrokeWidth, string> = {
  THIN: '얇은 굵기',
  MEDIUM: '보통 굵기',
  THICK: '굵은 굵기'
};

type Props = {
  settings: ToolSettings;
  onChange: (settings: ToolSettings) => void;
  disabled: boolean;
  canUndo: boolean;
  onUndo: () => void;
  onClear: () => void;
};

export const DrawingToolbar = ({
  settings,
  onChange,
  disabled,
  canUndo,
  onUndo,
  onClear
}: Props) => (
  <section className="drawing-toolbar panel-section" aria-label="그림 도구">
    <div className="tool-row" role="group" aria-label="도구 선택">
      <button
        type="button"
        className={`tool-icon-button ${settings.tool === 'PEN' ? 'selected' : ''}`}
        aria-label="펜"
        aria-pressed={settings.tool === 'PEN'}
        title="펜"
        disabled={disabled}
        onClick={() => onChange({ ...settings, tool: 'PEN' })}
      >
        <span className="pen-icon" aria-hidden="true">✎</span>
      </button>
      <button
        type="button"
        className={`tool-icon-button ${settings.tool === 'ERASER' ? 'selected' : ''}`}
        aria-label="지우개"
        aria-pressed={settings.tool === 'ERASER'}
        title="지우개"
        disabled={disabled}
        onClick={() => onChange({ ...settings, tool: 'ERASER' })}
      >
        <span className="eraser-icon" aria-hidden="true" />
      </button>
    </div>
    <div className="palette" role="group" aria-label="펜 색상">
      {(Object.keys(PALETTE) as PaletteColor[]).map((color) => (
        <button
          type="button"
          key={color}
          className={`color-button ${settings.color === color && settings.tool === 'PEN' ? 'selected' : ''}`}
          aria-label={PALETTE[color].label}
          aria-pressed={settings.color === color && settings.tool === 'PEN'}
          disabled={disabled}
          onClick={() => onChange({ ...settings, tool: 'PEN', color })}
        >
          <span style={{ backgroundColor: PALETTE[color].hex }} />
        </button>
      ))}
    </div>
    <div className="tool-row" role="group" aria-label="굵기 선택">
      {(Object.keys(STROKE_WIDTHS) as StrokeWidth[]).map((width) => (
        <button
          type="button"
          key={width}
          className={`width-button ${settings.width === width ? 'selected' : ''}`}
          aria-label={WIDTH_LABELS[width]}
          aria-pressed={settings.width === width}
          title={WIDTH_LABELS[width]}
          disabled={disabled}
          onClick={() => onChange({ ...settings, width })}
        >
          <span className={`width-dot width-dot-${width.toLowerCase()}`} aria-hidden="true" />
        </button>
      ))}
    </div>
    <div className="tool-row">
      <button
        type="button"
        className="tool-icon-button"
        aria-label="되돌리기"
        title="되돌리기"
        disabled={disabled || !canUndo}
        onClick={onUndo}
      >
        <span className="undo-icon" aria-hidden="true">↶</span>
      </button>
      <button type="button" className="danger clear-button" disabled={disabled} onClick={onClear}>
        전체 지우기
      </button>
    </div>
  </section>
);
