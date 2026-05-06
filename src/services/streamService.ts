export interface StreamCallbacks {
  onToken: (token: string) => void
  onDone: (fullText: string) => void
  onError: (error: string) => void
}

export interface StreamOptions {
  baseUrl: string
  apiKey: string
  modelId: string
  messages: { role: string; content: string }[]
  temperature?: number
  maxTokens?: number
  extraHeaders?: Record<string, string>
  providerType: 'openai' | 'anthropic' | 'custom'
  requestBody?: string
  responsePath?: string
}

export function createAbortController(): AbortController {
  return new AbortController()
}

async function parseOpenAISSE(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  callbacks: StreamCallbacks,
  signal: AbortSignal
): Promise<string> {
  const decoder = new TextDecoder()
  let fullText = ''
  let buffer = ''

  try {
    while (true) {
      if (signal.aborted) {
        callbacks.onDone(fullText)
        return fullText
      }

      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || trimmed === ':') continue
        if (trimmed === 'data: [DONE]') {
          callbacks.onDone(fullText)
          return fullText
        }
        if (trimmed.startsWith('data: ')) {
          try {
            const json = JSON.parse(trimmed.slice(6))
            const token = json.choices?.[0]?.delta?.content
            if (token) {
              fullText += token
              callbacks.onToken(token)
            }
          } catch {
            // skip malformed JSON
          }
        }
      }
    }

    if (buffer.trim() && buffer.trim() !== 'data: [DONE]') {
      if (buffer.trim().startsWith('data: ')) {
        try {
          const json = JSON.parse(buffer.trim().slice(6))
          const token = json.choices?.[0]?.delta?.content
          if (token) {
            fullText += token
            callbacks.onToken(token)
          }
        } catch {
          // skip
        }
      }
    }

    callbacks.onDone(fullText)
    return fullText
  } catch (error) {
    if (signal.aborted) {
      callbacks.onDone(fullText)
      return fullText
    }
    throw error
  }
}

async function parseAnthropicSSE(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  callbacks: StreamCallbacks,
  signal: AbortSignal
): Promise<string> {
  const decoder = new TextDecoder()
  let fullText = ''
  let buffer = ''

  try {
    while (true) {
      if (signal.aborted) {
        callbacks.onDone(fullText)
        return fullText
      }

      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('event:')) continue

        if (trimmed.startsWith('data: ')) {
          try {
            const json = JSON.parse(trimmed.slice(6))

            if (json.type === 'content_block_delta' && json.delta?.type === 'text_delta') {
              const token = json.delta.text
              if (token) {
                fullText += token
                callbacks.onToken(token)
              }
            } else if (json.type === 'message_stop') {
              callbacks.onDone(fullText)
              return fullText
            } else if (json.type === 'error') {
              callbacks.onError(json.error?.message || 'Anthropic API error')
              return fullText
            }
          } catch {
            // skip malformed JSON
          }
        }
      }
    }

    callbacks.onDone(fullText)
    return fullText
  } catch (error) {
    if (signal.aborted) {
      callbacks.onDone(fullText)
      return fullText
    }
    throw error
  }
}

export async function streamChatCompletion(
  options: StreamOptions,
  callbacks: StreamCallbacks,
  abortController: AbortController
): Promise<string> {
  const { providerType } = options
  const signal = abortController.signal

  try {
    if (providerType === 'anthropic') {
      return await streamAnthropic(options, callbacks, signal)
    } else {
      return await streamOpenAICompatible(options, callbacks, signal)
    }
  } catch (error) {
    if (signal.aborted) {
      return ''
    }
    const message = error instanceof Error ? error.message : String(error)
    callbacks.onError(message)
    throw error
  }
}

async function streamOpenAICompatible(
  options: StreamOptions,
  callbacks: StreamCallbacks,
  signal: AbortSignal
): Promise<string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...options.extraHeaders
  }

  if (options.apiKey) {
    headers['Authorization'] = `Bearer ${options.apiKey}`
  }

  let body: Record<string, unknown>
  if (options.requestBody) {
    try {
      body = JSON.parse(options.requestBody)
      body.messages = options.messages
      body.stream = true
      if (options.temperature !== undefined) body.temperature = options.temperature
      if (options.maxTokens !== undefined) body.max_tokens = options.maxTokens
    } catch {
      body = {
        model: options.modelId,
        messages: options.messages,
        temperature: options.temperature ?? 0.7,
        max_tokens: options.maxTokens ?? 2000,
        stream: true
      }
    }
  } else {
    body = {
      model: options.modelId,
      messages: options.messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? 2000,
      stream: true
    }
  }

  const response = await fetch(options.baseUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal
  })

  if (!response.ok) {
    let errorMsg = `HTTP ${response.status}`
    try {
      const errorData = await response.json()
      errorMsg = errorData.error?.message || errorData.message || errorMsg
    } catch {
      // use default error msg
    }
    callbacks.onError(errorMsg)
    throw new Error(errorMsg)
  }

  const reader = response.body?.getReader()
  if (!reader) {
    callbacks.onError('No response body')
    throw new Error('No response body')
  }

  return parseOpenAISSE(reader, callbacks, signal)
}

async function streamAnthropic(
  options: StreamOptions,
  callbacks: StreamCallbacks,
  signal: AbortSignal
): Promise<string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'anthropic-version': '2023-06-01',
    'x-api-key': options.apiKey
  }

  const systemMessage = options.messages.find(m => m.role === 'system')
  const userMessages = options.messages.filter(m => m.role !== 'system')

  const body: Record<string, unknown> = {
    model: options.modelId,
    messages: userMessages,
    temperature: options.temperature ?? 0.7,
    max_tokens: options.maxTokens ?? 2000,
    stream: true
  }

  if (systemMessage) {
    body.system = systemMessage.content
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal
  })

  if (!response.ok) {
    let errorMsg = `HTTP ${response.status}`
    try {
      const errorData = await response.json()
      errorMsg = errorData.error?.message || errorData.message || errorMsg
    } catch {
      // use default error msg
    }
    callbacks.onError(errorMsg)
    throw new Error(errorMsg)
  }

  const reader = response.body?.getReader()
  if (!reader) {
    callbacks.onError('No response body')
    throw new Error('No response body')
  }

  return parseAnthropicSSE(reader, callbacks, signal)
}
