interface ToolDurationInputProps {
  id: string;
  label: string;
  minutes: number;
  minMinutes: number;
  maxMinutes: number;
  onMinutesChange: (nextMinutes: number) => void;
  disabled?: boolean;
  hint?: string;
}

function clampMinute(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.round(value)));
}

export default function ToolDurationInput({
  id,
  label,
  minutes,
  minMinutes,
  maxMinutes,
  onMinutesChange,
  disabled = false,
  hint,
}: ToolDurationInputProps) {
  const updateMinutes = (nextMinutes: number) => {
    onMinutesChange(clampMinute(nextMinutes, minMinutes, maxMinutes));
  };

  return (
    <div className="tools-duration-field">
      <div className="tools-field-copy">
        <label htmlFor={id}>{label}</label>
        {hint ? <p>{hint}</p> : null}
      </div>

      <div className="tools-duration-control">
        <input
          id={id}
          type="number"
          min={minMinutes}
          max={maxMinutes}
          step={1}
          value={minutes}
          disabled={disabled}
          onChange={(event) => updateMinutes(Number(event.target.value))}
          className="qp-input tools-duration-input"
        />
      </div>
    </div>
  );
}
