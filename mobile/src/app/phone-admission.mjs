/** Identity changes cancel intent; temporary ownership only delays admission. */
export function phoneAdmission(state,{viewOnly=false}={}) {
  if(state.hidden)return {category:'invalidated',reason:'Opening cancelled while the app is in the background.'};
  if(state.storageError||state.recoveryError)return {category:'protected',reason:'Resolve device recovery before opening another task.'};
  if(state.protected)return {category:'protected',reason:'Finish or resolve the current protected work before opening another task.'};
  if(state.saving)return {category:'waiting',reason:'Finishing the device save…'};
  if(state.closing)return {category:'waiting',reason:'Finishing the previous task…'};
  if(!viewOnly&&(state.reading||!state.ready))return {category:'waiting',reason:'Preparing current records…'};
  return {category:'ready',reason:''};
}
