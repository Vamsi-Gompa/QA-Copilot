import React from 'react';
import QaIcon from './QaIcon';

interface Props {
  title: string;
  value: string | number;
  description?: string;
  icon: string;
  color?: string;
  trend?: string;
  delay?: number;
  onClick?: () => void;
}

export default function MetricCard({ title, value, description, icon, color = '#00BFB3', trend, delay = 0, onClick }: Props) {
  return (
    <div
      className={`qa-metric qa-glass${onClick ? ' qa-metric--clickable' : ''}`}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={e => {
        if (onClick && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onClick();
        }
      }}
      style={{ animationDelay: `${delay}s` }}
    >
      {/* Icon */}
      <div className="qa-metric__icon" style={{ background: `${color}18` }}>
        <QaIcon type={icon as any} size="l" color={color} />
      </div>

      {/* Value */}
      <div className="qa-metric__value" style={{ color }}>
        {value}
      </div>

      {/* Label */}
      <div className="qa-metric__label">{title}</div>

      {/* Sub info */}
      {(description || trend) && (
        <div className="qa-metric__sub" style={{ marginTop: 4 }}>
          {trend && (
            <span style={{ color: trend.startsWith('+') ? '#7DE2D1' : '#F86B63', marginRight: 6, fontWeight: 600 }}>
              {trend}
            </span>
          )}
          {description}
        </div>
      )}
    </div>
  );
}
