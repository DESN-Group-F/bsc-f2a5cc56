import { Capacitor } from '@capacitor/core';
import { usesIosPresentation } from './ios-presentation.mjs';

const platform=Capacitor.getPlatform();
export const iosPresentation = usesIosPresentation({ platform, native:platform!=='web', search:globalThis.location?.search });

/** App lifetime, including sign-in, diagnostics and body-mounted business dialogs. */
export function activateIosPresentation(document, enabled = iosPresentation) {
  if (!enabled) return;
  document.documentElement.setAttribute('data-ios-presentation','true');
  document.body.setAttribute('data-ios-presentation','true');
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content','#10141b');
}
