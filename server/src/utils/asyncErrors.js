// Express 4 does not forward rejected promises from async handlers to the
// error middleware: an unexpected throw (e.g. a Mongoose CastError on a
// malformed id) becomes an unhandled rejection, which terminates Node.
// `catchAsyncErrors(router)` rewrites every handler of a router (and of the
// routers nested in it) so rejections reach `next(err)` instead.

function wrap(fn) {
  if (typeof fn !== 'function' || fn.length === 4 || fn.__asyncWrapped) return fn;
  const wrapped = function asyncWrapped(req, res, next) {
    try {
      const out = fn(req, res, next);
      if (out && typeof out.then === 'function') out.catch(next);
    } catch (err) {
      next(err);
    }
  };
  wrapped.__asyncWrapped = true;
  // Keep router internals (e.g. nested Router instances) reachable.
  if (Array.isArray(fn.stack)) wrapped.stack = fn.stack;
  return wrapped;
}

function patchStack(stack) {
  for (const layer of stack || []) {
    if (layer.route) {
      patchStack(layer.route.stack);
    } else if (layer.handle) {
      if (Array.isArray(layer.handle.stack)) patchStack(layer.handle.stack);
      layer.handle = wrap(layer.handle);
    }
  }
}

function catchAsyncErrors(router) {
  patchStack(router.stack);
  return router;
}

// Translate common Mongoose/Mongo failures into meaningful HTTP statuses.
function errorStatus(err) {
  if (err.status) return err.status;
  if (err.name === 'CastError') return 400;
  if (err.name === 'ValidationError') return 400;
  if (err.code === 11000) return 409;
  if (err.type === 'entity.too.large') return 413;
  if (err.type === 'entity.parse.failed') return 400;
  return 500;
}

function errorMessage(err, status) {
  if (err.name === 'CastError') return `Identifiant ou valeur invalide (${err.path}).`;
  if (err.code === 11000) return 'Cet élément existe déjà.';
  if (err.type === 'entity.too.large') return 'Requête trop volumineuse.';
  if (status >= 500) return 'Erreur serveur.';
  return err.message || 'Requête invalide.';
}

module.exports = { catchAsyncErrors, errorStatus, errorMessage };
