export const CONSTANTS = {
  JWT: {
    ACCESS_TOKEN_EXPIRE: '15m',
    REFRESH_TOKEN_EXPIRE: '7d'
  },
  
  RATE_LIMIT: {
    WINDOW_MS: 60 * 60 * 1000, // 1 hour
    MAX_REQUESTS: 100,
    AI_MAX_REQUESTS: 20
  },
  
  PAGINATION: {
    DEFAULT_PAGE: 1,
    DEFAULT_LIMIT: 10,
    MAX_LIMIT: 100
  },
  
  CACHE: {
    SCHEMA_TTL: 30 * 60, // 30 minutes
    CHAT_HISTORY_TTL: 90 * 24 * 60 * 60, // 90 days
    CONNECTION_POOL_IDLE: 30 * 60 * 1000 // 30 minutes
  },
  
  MONGODB: {
    CONNECTION_TIMEOUT: 5000,
    MAX_POOL_SIZE: 10,
    SAMPLE_SIZE: 100
  },
  
  VALIDATION: {
    PASSWORD_MIN_LENGTH: 8,
    PROJECT_NAME_MAX_LENGTH: 50,
    ORGANIZATION_NAME_MAX_LENGTH: 100,
    MESSAGE_MAX_LENGTH: 1000
  },
  
  ROLES: {
    ADMIN: 'admin',
    EDITOR: 'editor',
    VIEWER: 'viewer'
  },
  
  RESPONSE_MESSAGES: {
    SUCCESS: 'Operation successful',
    CREATED: 'Resource created successfully',
    UPDATED: 'Resource updated successfully',
    DELETED: 'Resource deleted successfully',
    INVALID_CREDENTIALS: 'Invalid email or password',
    UNAUTHORIZED: 'Please authenticate to access this resource',
    FORBIDDEN: 'You do not have permission to perform this action',
    NOT_FOUND: 'Resource not found',
    VALIDATION_ERROR: 'Validation failed',
    SERVER_ERROR: 'Internal server error',
    CONNECTION_ERROR: 'Connection failed',
    RATE_LIMIT_EXCEEDED: 'Too many requests, please try again later'
  }
};

export const REGEX_PATTERNS = {
  EMAIL: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  MONGODB_URI: /^mongodb(\+srv)?:\/\/.+/,
  OBJECT_ID: /^[0-9a-fA-F]{24}$/,
  COLLECTION_REFERENCE: /^[a-zA-Z_][a-zA-Z0-9_]*_(id|Id|ID|ref|Ref|REF)$/
};