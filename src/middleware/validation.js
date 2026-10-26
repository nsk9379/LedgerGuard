const Joi = require('joi');

const uuidSchema = Joi.string().uuid({ version: 'uuidv4' });

const validate = (schema) => (req, res, next) => {
  const { error } = schema.validate(req.body, { abortEarly: false });
  if (error) {
    return res.status(400).json({
      status: 'error',
      message: 'Validation failed',
      details: error.details.map((d) => d.message),
    });
  }
  next();
};

// Maximum amount allowed for NUMERIC(20,4) (16 digits integer, 4 digits precision)
const MAX_NUMERIC_AMOUNT = 9999999999999999.9999;
const amountSchema = Joi.number().positive().precision(4).max(MAX_NUMERIC_AMOUNT).required();

const schemas = {
  createAccount: Joi.object({
    userId: Joi.string().uuid().required(),
    accountType: Joi.string().valid('checking', 'savings', 'business', 'loan').required(),
    currency: Joi.string().length(3).uppercase().default('INR'),
    description: Joi.string().max(255).optional().allow(''),
  }),

  transfer: Joi.object({
    sourceAccountId: Joi.string().uuid().required(),
    destinationAccountId: Joi.string().uuid().required(),
    amount: amountSchema,
    currency: Joi.string().length(3).uppercase().default('INR'),
    description: Joi.string().max(500).optional().allow(''),
  }),

  deposit: Joi.object({
    accountId: Joi.string().uuid().required(),
    amount: amountSchema,
    currency: Joi.string().length(3).uppercase().default('INR'),
    description: Joi.string().max(500).optional().allow(''),
  }),

  withdrawal: Joi.object({
    accountId: Joi.string().uuid().required(),
    amount: amountSchema,
    currency: Joi.string().length(3).uppercase().default('INR'),
    description: Joi.string().max(500).optional().allow(''),
  }),
};

module.exports = { validate, schemas };
