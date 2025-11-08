export const groqConfig = {
  models: {
    default: 'mixtral-8x7b-32768',
    fast: 'llama3-8b-8192',
    large: 'llama3-70b-8192'
  },
  
  parameters: {
    temperature: 0.7,
    maxTokens: 2048,
    topP: 1,
    stream: true
  },

  rateLimits: {
    requestsPerMinute: 30,
    tokensPerMinute: 15000
  },

  prompts: {
    maxSystemPromptLength: 4000,
    maxHistoryMessages: 10,
    maxMessageLength: 1000
  }
};