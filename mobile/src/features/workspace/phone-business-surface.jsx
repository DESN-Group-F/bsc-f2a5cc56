import { DialogPresentationProvider } from '../../shared/components/ui/dialog.js';

/** React portals inherit this task; request, permission and exit semantics remain in the business component. */
export function PhoneBusinessSurface({ task, active = true, children }) {
  return <DialogPresentationProvider value={active ? task : undefined}><div className="mobile-business-surface" data-business-task={task} hidden={!active}>{children}</div></DialogPresentationProvider>;
}
