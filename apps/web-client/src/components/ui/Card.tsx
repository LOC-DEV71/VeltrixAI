import React from 'react';

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  noPadding?: boolean;
}

export const Card: React.FC<CardProps> = ({ children, className = '', noPadding = false, ...props }) => {
  return (
    <div 
      className={`bg-[var(--color-bg-surface)] rounded-xl border border-[var(--color-border)] shadow-sm overflow-hidden ${noPadding ? '' : 'p-4'} ${className}`}
      {...props}
    >
      {children}
    </div>
  );
};
