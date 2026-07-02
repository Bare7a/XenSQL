import { Search } from 'lucide-react';
import type { ReactNode } from 'react';

interface Props {
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  children: ReactNode;
}

export function SidebarFilterBar({ value, placeholder, onChange, disabled, children }: Props) {
  return (
    <div className="sidebar-filter">
      <Search className="sidebar-filter-icon" aria-hidden />
      <input
        type="search"
        className="sidebar-filter-input"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      />
      {children}
    </div>
  );
}
