export const serverConfig = {
  port: process.env.PORT || 8000,
  env: process.env.NODE_ENV || 'development',
  
  cors: {
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],
    exposedHeaders: ['X-Total-Count', 'X-Page-Count'],
    maxAge: 86400
  },

  security: {
    jwtSecret: process.env.JWT_SECRET!,
    jwtRefreshSecret: process.env.JWT_REFRESH_SECRET!,
    encryptionKey: process.env.ENCRYPTION_KEY!,
    bcryptRounds: 12
  },

  rateLimit: {
    windowMs: 60 * 60 * 1000,
    maxRequests: 100,
    aiMaxRequests: 20
  },

  upload: {
    maxFileSize: 10 * 1024 * 1024, // 10MB
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
  },

  pagination: {
    defaultPage: 1,
    defaultLimit: 10,
    maxLimit: 100
  }
};