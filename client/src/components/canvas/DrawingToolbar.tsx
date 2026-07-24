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
        className={settings.tool === 'PEN' ? 'selected' : ''}
        aria-pressed={settings.tool === 'PEN'}
        disabled={disabled}
        onClick={() => onChange({ ...settings, tool: 'PEN' })}
      >
        펜
      </button>
      <button
        type="button"
        className={settings.tool === 'ERASER' ? 'selected' : ''}
        aria-pressed={settings.tool === 'ERASER'}
        disabled={disabled}
        onClick={() => onChange({ ...settings, tool: 'ERASER' })}
      >
        지우개
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
          <small>{PALETTE[color].label}</small>
        </button>
      ))}
    </div>
    <div className="tool-row" role="group" aria-label="굵기 선택">
      {(Object.keys(STROKE_WIDTHS) as StrokeWidth[]).map((width) => (
        <button
          type="button"
          key={width}
          className={settings.width === width ? 'selected' : ''}
          aria-pressed={settings.width === width}
          disabled={disabled}
          onClick={() => onChange({ ...settings, width })}
        >
          {{ THIN: '얇게', MEDIUM: '보통', THICK: '굵게' }[width]}
        </button>
      ))}
    </div>
    <div className="tool-row">
      <button type="button" disabled={disabled || !canUndo} onClick={onUndo}>되돌리기</button>
      <button type="button" className="danger" disabled={disabled} onClick={onClear}>전체 지우기</button>
    </div>
  </section>
);
