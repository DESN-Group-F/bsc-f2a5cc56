import React from 'react';

/** Two cells share the same geometry across the iOS icon and launch artwork. */
export function IosBrandMark({ className = '' }) {
  return <svg className={'ios-brand-mark '+className} viewBox="0 0 48 48" fill="none" aria-hidden="true">
    <rect width="48" height="48" rx="14" fill="#438cec"/>
    <g className="ios-brand-cells" fill="#fff">
      <rect x="13" y="16" width="8" height="18" rx="4"/>
      <rect x="27" y="16" width="8" height="18" rx="4"/>
      <path d="M16 13h2m12 0h2" stroke="#fff" strokeWidth="2" strokeLinecap="round"/>
    </g>
  </svg>;
}
