/**
 * Safe JSON parsing for HTTP responses.
 * Never throws an unhandled exception; callers receive a controlled error object.
 * Logs URL, HTTP status, error type and response size — never tokens/cookies/PII.
 */
export type JsonParseFailure = {
    url: string
    status: number | undefined
    errorType: string
    responseSize: number
    message: 'JSON.parse failed'
}

export function safeParseJsonResponse(
    responseData: string,
    meta: { url: string; status?: number },
    log?: (message: string, details: Record<string, unknown>) => void,
): { ok: true; value: any } | { ok: false; error: JsonParseFailure } {
    if(!responseData || responseData.trim() === ''){
        return { ok: true, value: responseData }
    }

    try {
        return { ok: true, value: JSON.parse(responseData) }
    } catch(error){
        const errorType = error instanceof Error ? error.name : typeof error
        const failure: JsonParseFailure = {
            url: meta.url,
            status: meta.status,
            errorType,
            responseSize: Buffer.byteLength(responseData, 'utf8'),
            message: 'JSON.parse failed',
        }
        if(log){
            log('JSON parse failed', {
                url: failure.url,
                status: failure.status,
                errorType: failure.errorType,
                responseSize: failure.responseSize,
            })
        }
        return { ok: false, error: failure }
    }
}

export function sanitizeHeaders(headers: Record<string, unknown> = {}) {
    const sanitized: Record<string, unknown> = { ...headers }
    for(const key of Object.keys(sanitized)){
        const lower = key.toLowerCase()
        if(
            lower === 'authorization' ||
            lower === 'cookie' ||
            lower === 'set-cookie' ||
            lower.includes('token') ||
            lower.includes('auth')
        ){
            sanitized[key] = '[redacted]'
        }
    }
    return sanitized
}
