import React from 'react';
import { iosPresentation } from '../../app/ios-runtime-presentation.mjs';
import { IosInkCharacter } from '../../app/ios-ink-character.jsx';
import { InkOrb } from './ink-orb.jsx';

/** Both platforms reuse the original character; iOS adds its activation and launch adapter. */
export function ScanCharacter(props) {
  return iosPresentation ? <IosInkCharacter {...props}/> : <InkOrb {...props}/>;
}
