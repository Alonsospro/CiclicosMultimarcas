class PersistenceError extends Error {
  constructor(message, code = 'PERSISTENCE_UNAVAILABLE', status = 503) {
    super(message);
    this.code = code;
    this.status = status;
  }
}
module.exports = PersistenceError;
