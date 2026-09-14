// Error carrying an HTTP status and a machine-readable code (rendered by index.js).
function httpError(status, code, message, extra = {}) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  Object.assign(err, extra);
  return err;
}

module.exports = { httpError };
