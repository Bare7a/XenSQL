import { useTranslation } from 'react-i18next';

interface MenuStepperRowProps {
  label: string;
  value: string;
  decrementDisabled: boolean;
  incrementDisabled: boolean;
  resetDisabled: boolean;
  decrementLabel: string;
  incrementLabel: string;
  resetLabel: string;
  onDecrement: () => void;
  onIncrement: () => void;
  onReset: () => void;
}

export function MenuStepperRow({
  label,
  value,
  decrementDisabled,
  incrementDisabled,
  resetDisabled,
  decrementLabel,
  incrementLabel,
  resetLabel,
  onDecrement,
  onIncrement,
  onReset,
}: MenuStepperRowProps) {
  const { t } = useTranslation();
  return (
    <div className="menu-stepper-row menu-stepper-row-full">
      <span className="menu-stepper-label">{label}</span>
      <span className="menu-stepper-value" aria-live="polite">
        {value}
      </span>
      <button type="button" className="menu-stepper-btn" disabled={decrementDisabled} onClick={onDecrement} aria-label={decrementLabel}>−</button>
      <button type="button" className="menu-stepper-btn" disabled={incrementDisabled} onClick={onIncrement} aria-label={incrementLabel}>+</button>
      <button type="button" className="menu-stepper-btn menu-stepper-btn-reset" disabled={resetDisabled} onClick={onReset} aria-label={resetLabel}>{t('uiZoom.reset')}</button>
    </div>
  );
}
