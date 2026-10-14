export const FEEDBACK_KEY = 'preference:mobile-feedback';
export const SUCCESS_INTERVAL_MS = 1750;
export function readFeedbackPreferences(storage) {
  try {
    const value = JSON.parse(storage.getItem(FEEDBACK_KEY) || '{}');
    return { haptics: typeof value.haptics === 'boolean' ? value.haptics : true, sounds: typeof value.sounds === 'boolean' ? value.sounds : false, strength: ['light', 'medium'].includes(value.strength) ? value.strength : 'light' };
  } catch { return { haptics: true, sounds: false, strength: 'light' }; }
}
/** Duplicate expression does not start or extend a color pulse. */
export function scanFeedbackOutcome(previous, result, at) {
  const sequence = (previous.sequence || 0) + 1;
  if (result.type === 'duplicate') return { ...previous, sequence, event: 'duplicate', outcomeType: 'duplicate', expression: 'duplicate', expressionUntil: at + 950, capsule: result.message, message: result.message };
  if (result.type === 'accepted') return { sequence, successSequence: sequence, event: 'accepted', outcomeType: 'accepted', tone: 'success', until: at + SUCCESS_INTERVAL_MS, expression: '', expressionUntil: 0, capsule: '', latest: result.battery, message: result.message };
  if (result.type === 'failure') return { sequence, successSequence: previous.successSequence, event: 'failure', outcomeType: 'failure', tone: 'failure', until: at + 950, expression: 'failure', expressionUntil: at + 950, capsule: '', latest: null, message: result.message, code: result.code || '' };
  return { ...previous, message: result.message };
}
export function expireScanFeedback(value, at) {
  return { ...value, tone: value.until > at ? value.tone : '', expression: value.expressionUntil > at ? value.expression : '' };
}
export function playScanFeedback(result, preferences, native = false) {
  if (!['accepted', 'failure', 'duplicate'].includes(result.type)) return;
  if (preferences.haptics) {
    const duration = preferences.strength === 'medium' ? 25 : 12;
    if (native && typeof window !== 'undefined' && window.__batteryMobileHaptic) { try { Promise.resolve(window.__batteryMobileHaptic(duration)).catch(() => {}); } catch { /* Text feedback remains available when haptics fail. */ } }
    else if (!native && typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(duration);
  }
  if (!preferences.sounds || typeof window === 'undefined') return;
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;
  try {
    const context = new AudioContext(), oscillator = context.createOscillator(), gain = context.createGain();
    oscillator.frequency.value = result.type === 'accepted' ? 660 : result.type === 'duplicate' ? 390 : 240;
    gain.gain.setValueAtTime(0.035, context.currentTime); gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.09);
    oscillator.connect(gain); gain.connect(context.destination); oscillator.start(); oscillator.stop(context.currentTime + 0.1);
    oscillator.onended = () => context.close();
  } catch { /* Audio may require a device gesture; textual feedback remains available. */ }
}
