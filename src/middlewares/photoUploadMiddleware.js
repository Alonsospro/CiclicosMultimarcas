const multer = require('multer');
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
}).single('photo');

// Finish receiving multipart data before taking the persistence queue slot.
// An interrupted client stream must not block every other API request.
module.exports = function photoUploadMiddleware(req, res, next) {
  if (req.photoUploadParsed) return next();
  upload(req, res, error => {
    if (error) return next(error);
    req.photoUploadParsed = true;
    next();
  });
};
