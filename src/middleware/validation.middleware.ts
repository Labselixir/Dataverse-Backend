import { Request, Response, NextFunction } from 'express';
import { body, param, query, validationResult } from 'express-validator';
import { ValidationError } from '../utils/errors';
import { REGEX_PATTERNS, CONSTANTS } from '../utils/constants';

export const handleValidationErrors = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const errors = validationResult(req);
  
  if (!errors.isEmpty()) {
    const errorMessages = errors.array().map(error => ({
      field: error.type === 'field' ? error.path : undefined,
      message: error.msg
    }));
    
    throw new ValidationError('Validation failed', errorMessages);
  }
  
  next();
};

// Auth validations
export const validateSignup = [
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email'),
  body('password')
    .isLength({ min: CONSTANTS.VALIDATION.PASSWORD_MIN_LENGTH })
    .withMessage(`Password must be at least ${CONSTANTS.VALIDATION.PASSWORD_MIN_LENGTH} characters`),
  body('name')
    .trim()
    .notEmpty()
    .withMessage('Name is required')
    .isLength({ max: 100 })
    .withMessage('Name cannot exceed 100 characters'),
  handleValidationErrors
];

export const validateLogin = [
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email'),
  body('password')
    .notEmpty()
    .withMessage('Password is required'),
  handleValidationErrors
];

// Connection validation - only mongoUri required
export const validateConnectionOnly = [
  body('mongoUri')
    .notEmpty()
    .withMessage('MongoDB URI is required')
    .isString()
    .withMessage('MongoDB URI must be a string')
    .custom((value) => {
      // Check if it contains placeholder password
      if (value.includes('<db_password>') || value.includes('<password>')) {
        throw new Error('Please replace <db_password> with your actual password');
      }
      // Basic MongoDB URI validation
      if (!value.startsWith('mongodb://') && !value.startsWith('mongodb+srv://')) {
        throw new Error('Invalid MongoDB URI format');
      }
      return true;
    }),
  handleValidationErrors
];

// Project validations
export const validateCreateProject = [
  body('name')
    .trim()
    .notEmpty()
    .withMessage('Project name is required')
    .isLength({ max: CONSTANTS.VALIDATION.PROJECT_NAME_MAX_LENGTH })
    .withMessage(`Project name cannot exceed ${CONSTANTS.VALIDATION.PROJECT_NAME_MAX_LENGTH} characters`),
  body('mongoUri')
    .notEmpty()
    .withMessage('MongoDB URI is required')
    .custom((value) => {
      if (value.includes('<db_password>') || value.includes('<password>')) {
        throw new Error('Please replace <db_password> with your actual password');
      }
      if (!value.startsWith('mongodb://') && !value.startsWith('mongodb+srv://')) {
        throw new Error('Invalid MongoDB URI format');
      }
      return true;
    }),
  body('apiKey')
    .optional()
    .isString()
    .withMessage('API key must be a string'),
  handleValidationErrors
];

export const validateUpdateProject = [
  param('id')
    .matches(REGEX_PATTERNS.OBJECT_ID)
    .withMessage('Invalid project ID'),
  body('name')
    .optional()
    .trim()
    .isLength({ max: CONSTANTS.VALIDATION.PROJECT_NAME_MAX_LENGTH })
    .withMessage(`Project name cannot exceed ${CONSTANTS.VALIDATION.PROJECT_NAME_MAX_LENGTH} characters`),
  body('apiKey')
    .optional()
    .isString()
    .withMessage('API key must be a string'),
  handleValidationErrors
];

export const validateCreateOrganization = [
  body('name')
    .trim()
    .notEmpty()
    .withMessage('Organization name is required')
    .isLength({ max: CONSTANTS.VALIDATION.ORGANIZATION_NAME_MAX_LENGTH })
    .withMessage(`Organization name cannot exceed ${CONSTANTS.VALIDATION.ORGANIZATION_NAME_MAX_LENGTH} characters`),
  handleValidationErrors
];

export const validateInviteMember = [
  param('id')
    .matches(REGEX_PATTERNS.OBJECT_ID)
    .withMessage('Invalid organization ID'),
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email'),
  body('role')
    .isIn(['admin', 'editor', 'viewer'])
    .withMessage('Invalid role'),
  handleValidationErrors
];

export const validateSendMessage = [
  body('projectId')
    .matches(REGEX_PATTERNS.OBJECT_ID)
    .withMessage('Invalid project ID'),
  body('message')
    .trim()
    .notEmpty()
    .withMessage('Message is required')
    .isLength({ max: CONSTANTS.VALIDATION.MESSAGE_MAX_LENGTH })
    .withMessage(`Message cannot exceed ${CONSTANTS.VALIDATION.MESSAGE_MAX_LENGTH} characters`),
  handleValidationErrors
];

export const validatePagination = [
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: CONSTANTS.PAGINATION.MAX_LIMIT })
    .withMessage(`Limit must be between 1 and ${CONSTANTS.PAGINATION.MAX_LIMIT}`),
  query('sortBy')
    .optional()
    .isIn(['createdAt', 'updatedAt', 'name', 'lastAccessed'])
    .withMessage('Invalid sort field'),
  query('order')
    .optional()
    .isIn(['asc', 'desc'])
    .withMessage('Order must be asc or desc'),
  handleValidationErrors
];

export const validateObjectId = [
  param('id')
    .matches(REGEX_PATTERNS.OBJECT_ID)
    .withMessage('Invalid ID format'),
  handleValidationErrors
];