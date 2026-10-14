import React from 'react';
import { phoneReadError } from './phone-read-error.mjs';
import { Pressable } from './phone-ui.jsx';

export function PhoneReadError({ error, onRetry, stale = false, message, compact = false, busy = false }) {
  const feedback = phoneReadError(error,message);
  const detail = compact ? feedback.detail || feedback.message : feedback.detail;
  return <section className={'phone-read-error' + (compact ? ' phone-read-error-compact' : '')} role="alert"><div><strong>{compact ? "Couldn't refresh records." : feedback.message}</strong>{stale && <p>{compact ? 'Last loaded records remain visible.' : 'Showing the last loaded records. They have not been updated.'}</p>}</div>{onRetry && <Pressable className={compact ? 'phone-text-action' : 'phone-secondary'} busy={busy} onClick={onRetry}>{busy ? 'Retrying…' : 'Retry'}</Pressable>}{detail && <details><summary>Technical details</summary><p>{detail}</p></details>}</section>;
}
