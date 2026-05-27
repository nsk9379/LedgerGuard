const errorHandler = (err, req, res, next) => {
  console.error(err);

  // Custom app errors with statusCode
  if (err.statusCode) {
    return res.status(err.statusCode).json({
      status: 'error',
      message: err.message,
    });
  }

  // PostgreSQL errors
  if (err.code) {
    switch (err.code) {
      case '23505': // unique violation
        return res.status(409).json({ status: 'error', message: 'Duplicate record.' });
      case '23503': // foreign key violation
        return res.status(400).json({ status: 'error', message: 'Referenced record does not exist.' });
      case '23514': // check constraint violation
        return res.status(422).json({ status: 'error', message: 'Constraint violation: ' + err.detail });
      default:
        break;
    }
  }

  return res.status(500).json({
    status: 'error',
    message: 'Internal server error.',
  });
};

module.exports = errorHandler;
