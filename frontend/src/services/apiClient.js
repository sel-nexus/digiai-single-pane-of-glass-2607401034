/** Adapt the common API envelope without fabricating missing evidence. */
export class ApiError extends Error {
  /** Preserve actionable failure classification for read and write consumers. */
  constructor(message, code = 'READ_UNAVAILABLE', details = {}) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.details = details;
  }
}

/** Serialize opaque IDs and repeated shared filters without comma encoding. */
export function serializeContext(context = {}, extra = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries({ personaId: context.personaId, hierarchyNodeId: context.hierarchyNodeId, ...context.filters, ...extra })) {
    for (const item of Array.isArray(value) ? value : [value]) {
      if (item !== null && item !== undefined && item !== '') query.append(key, String(item));
    }
  }
  return query.toString();
}

/** Validate status and envelope; never automatically retry an ambiguous write. */
async function request(path, options = {}) {
  const writing = options.method && options.method !== 'GET';
  try {
    const response = await fetch(`${import.meta.env.VITE_API_BASE_URL ?? '/api/v1'}${path}`, options);
    let body;
    try { body = await response.json(); }
    catch { throw new ApiError(writing ? 'Write completion is unconfirmed. Verify before retrying.' : 'The service returned an invalid response.', writing ? 'UNCONFIRMED' : 'INVALID_RESPONSE'); }
    if (!response.ok) {
      if (writing && response.status >= 500) throw new ApiError('Write completion is unconfirmed. Verify before retrying.', 'UNCONFIRMED');
      if (!body?.error || typeof body.error.message !== 'string' || typeof body.error.code !== 'string') throw new ApiError('The service returned an invalid error response.', 'INVALID_RESPONSE');
      throw new ApiError(body.error.message, body.error.code, body.error.details);
    }
    if (!body || !Object.hasOwn(body, 'data') || !['available', 'unavailable'].includes(body.availability)) {
      throw new ApiError(writing ? 'Write completion is unconfirmed. Verify before retrying.' : 'The service returned an invalid data envelope.', writing ? 'UNCONFIRMED' : 'INVALID_RESPONSE');
    }
    return body;
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    if (error instanceof ApiError) throw error;
    throw new ApiError(writing ? 'Write completion is unconfirmed. Verify before retrying.' : 'Cannot reach prototype service. Try again.', writing ? 'UNCONFIRMED' : 'READ_UNAVAILABLE');
  }
}

/** Fetch a qualified read for an explicit context and reporting period. */
export function getJson(path, context = {}, extra = {}, signal) {
  const query = serializeContext(context, extra);
  return request(`${path}${query ? `?${query}` : ''}`, { signal });
}

/** Submit an explicit JSON write; connection loss remains unconfirmed. */
export function postJson(path, body, signal) {
  return request(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
}
