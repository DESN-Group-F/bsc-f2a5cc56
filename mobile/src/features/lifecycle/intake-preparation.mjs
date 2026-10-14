import { modelApplication } from '../../shared/lib/battery-models.js';
import { isSelectableRoom } from '../../shared/lib/location-catalog.js';

export function intakePreparationFromBatch(batch) {
  const common = batch.common;
  return normalizedIntakePreparation({values:Object.fromEntries(Object.entries(common).filter(([key])=>key!=='modelSelection').map(([key,value])=>[key,value===null?'':String(value)])),firstUseMode:batch.firstUseMode,modelSelection:common.modelSelection || null,nameSource:common.modelSelection?.appliedFields.includes('name')?'model':common.name==='Battery'?'default':'custom'});
}

export function intakeBatchRows(batch,data) {
  const common=batch.common,person=data.people.find(item=>item.id===common.ownerId),account=data.staffDirectory.find(item=>item.id===person?.accountId),room=data.rooms.find(item=>item.id===common.homeRoomId);
  const owner=person?.role==='staff'&&account?.active ? `${person.name} · ${account.username || account.id}` : `Unavailable saved owner · ${common.ownerId}`;
  const home=!common.homeRoomId?'Room unspecified':room&&room.buildingId==='J18'&&isSelectableRoom(room)?`${room.name || room.number || room.id}${room.isPlaceholder?' · Unverified placeholder':''}`:`Unavailable saved room · ${common.homeRoomId}`;
  return [['Battery name',common.name],['Responsible owner',owner],['Model',common.model || 'Not recorded'],['Registered home',`${common.homeBuildingId} · ${home}`],['Specifications',`${common.chemistry || 'Chemistry unknown'} · ${common.capacityMah===null?'Capacity unknown':`${common.capacityMah} mAh`} · ${common.voltage===null?'Voltage unknown':`${common.voltage} V`}`],['Manufactured on',common.manufacturedOn || 'Not recorded'],['First use',batch.firstUseMode==='at_registration'?'Each confirmed registration date in Sydney':batch.firstUseMode==='unknown'?'Unknown':common.firstUsedOn || 'Not recorded'],['Model evidence',common.modelSelection?`${common.modelSelection.origin} · Reviewed fields: ${common.modelSelection.appliedFields.join(', ') || 'None; manual values retained'}`:'Manual values · No model selected']];
}

/** Naming intent is local UI metadata, never part of registered battery evidence. */
export function normalizedIntakePreparation(value) {
  const nameSource = value.nameSource || (value.values.name ? 'custom' : 'default');
  return { ...value, nameSource, values: { ...value.values, name: nameSource === 'default' && !value.values.name?.trim() ? 'Battery' : value.values.name } };
}
export function intakeModelInput(values, nameSource) {
  return nameSource === 'default' && values.name === 'Battery' ? { ...values, name: '' } : values;
}
export function changedIntakePreparation(value, field, next) {
  const current = normalizedIntakePreparation(value), selection = current.modelSelection;
  return { ...current, values: { ...current.values, [field]: next }, nameSource: field === 'name' ? 'custom' : current.nameSource, modelSelection: selection?.appliedFields.includes(field) ? { ...selection, appliedFields: selection.appliedFields.filter(item => item !== field) } : selection };
}
export function applyIntakePreparationModel(value, choice, fields) {
  const current = normalizedIntakePreparation(value);
  return { ...current, values: modelApplication(current.values, choice, fields), nameSource: fields.includes('name') ? 'model' : current.nameSource, modelSelection: { origin: choice.origin, id: choice.id, contentHash: choice.contentHash, confirmed: true, appliedFields: fields } };
}
