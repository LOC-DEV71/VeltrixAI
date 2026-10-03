import React from 'react';
import { ChevronDown } from 'lucide-react';

interface DropdownProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  options: { label: string; value: string }[];
}

export const Dropdown: React.FC<DropdownProps> = ({ label, options, className = '', ...props }) => {
  return (
    <div className="flex flex-col gap-1.5">
      {label && <label className="text-sm font-medium text-[var(--color-text-main)]">{label}</label>}
      <div className="relative">
        <select
          className={`appearance-none w-full px-3 py-2 pr-10 border border-[var(--color-border)] rounded bg-[var(--color-bg-surface)] text-[var(--color-text-main)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-transparent transition-all ${className}`}
          {...props}
        >
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <div className="absolute inset-y-0 right-0 flex items-center px-2 pointer-events-none text-gray-500">
          <ChevronDown size={16} />
        </div>
      </div>
    </div>
  );
};
