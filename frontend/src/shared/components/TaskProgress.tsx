interface Props {
  label: string;
  value: number;
  max: number;
}

/** The progress line shared by the export and import dialogs. */
export function TaskProgress({ label, value, max }: Props) {
  return (
    <div className="task-progress" aria-live="polite">
      <p className="task-progress-label">{label}</p>
      <progress className="task-progress-bar" value={value} max={max || 1} />
    </div>
  );
}

export function formatCount(n: number): string {
  return n.toLocaleString();
}
