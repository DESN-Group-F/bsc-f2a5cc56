import { useEffect, useRef } from 'react';

const active = new Set();
export function useWorkflowLock(locked = true) {
  const token = useRef(Symbol('workflow'));
  useEffect(() => {
    if (!locked) return;
    active.add(token.current);
    window.dispatchEvent(new CustomEvent('battery-mobile-workflow-active', { detail: true }));
    const captured = token.current;
    return () => { active.delete(captured); window.dispatchEvent(new CustomEvent('battery-mobile-workflow-active', { detail: active.size > 0 })); };
  }, [locked]);
}
export function WorkflowBoundary({ children }) { useWorkflowLock(); return children; }
