/** Check the existing model-choice contract without applying or replacing fields. */
export async function loadIntakeModelChoices(dataset) {
  const response = await fetch(`/api/battery-models?dataset=${dataset}`,{cache:'no-store'});
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'Battery models could not be checked. Retry before continuing this batch.');
  if (body.dataset !== dataset || !Array.isArray(body.models) || !Array.isArray(body.issues)) throw new Error('Battery models could not be verified for this inventory.');
  return body.models;
}

export function verifyIntakeModelSelection(selection,choices) {
  if (!selection) return;
  const choice = choices.find(item=>item.origin===selection.origin && item.id===selection.id);
  if (!choice || choice.contentHash!==selection.contentHash) throw new Error('The saved model is unavailable or changed. Set details for next scans and review the model again. Existing drafts are unchanged.');
}

export function intakeConfigurationFailure(error) {
  const failure = new Error(error?.issues?.[0]?.message || error?.message || 'The saved batch details could not be checked.',{cause:error});
  failure.code = 'INTAKE_CONFIGURATION_INVALID'; failure.intakeConfiguration = true;
  if(error?.issues)failure.issues=error.issues;
  return failure;
}
