import { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/errors';
import { logger } from '../utils/logger';
import { CONSTANTS } from '../utils/constants';

export const errorMiddleware = (
  err: Error | AppError,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  if (res.headersSent) {
    return next(err);
  }

  let statusCode = 500;
  let message = CONSTANTS.RESPONSE_MESSAGES.SERVER_ERROR;
  let details = undefined;

  if (err instanceof AppError) {
    statusCode = err.statusCode;
    message = err.message;
    details = err.details;
  } else if (err.name === 'ValidationError') {
    statusCode = 400;
    message = CONSTANTS.RESPONSE_MESSAGES.VALIDATION_ERROR;
    details = err.message;
  } else if (err.name === 'CastError') {
    statusCode = 400;
    message = 'Invalid ID format';
  } else if (err.name === 'MongoServerError' && (err as any).code === 11000) {
    statusCode = 409;
    message = 'Duplicate value error';
    const field = Object.keys((err as any).keyValue)[0];
    details = `${field} already exists`;
  }

  // Log error
  logger.error({
    statusCode,
    message: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
    body: req.body,
    user: (req as any).user?.userId
  });

  // Send error response
  res.status(statusCode).json({
    success: false,
    error: message,
    ...(process.env.NODE_ENV === 'development' && { 
      details,
      stack: err.stack 
    })
  });
};

export const notFoundHandler = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  res.status(404).json({
    success: false,
    error: CONSTANTS.RESPONSE_MESSAGES.NOT_FOUND,
    message: `Route ${req.originalUrl} not found`
  });
};