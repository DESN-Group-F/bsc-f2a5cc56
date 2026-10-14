/** Only use for GET/read failures. Submission and durable-recovery errors keep their original meaning. */
export function phoneReadError(error, message = "Couldn't refresh. Try again.") {
  const detail = typeof error === 'string' ? error : error?.message || 'The read could not be completed.';
  const transport = ['NETWORK_UNCERTAIN','NETWORK_ERROR'].includes(error?.code) || /^(?:No authoritative response was received\.|Failed to fetch|NetworkError|Network request failed|Load failed|The USB test could not confirm this request\.)/i.test(detail);
  return { message: transport ? message : detail, detail: transport ? detail : '', transport };
}
