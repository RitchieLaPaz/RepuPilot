const winston = require('winston');
const config  = require('../config');

const logger = winston.createLogger({
  level: config.env === 'production' ? 'info' : 'debug',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    config.env === 'production'
      ? winston.format.json()
      : winston.format.prettyPrint()
  ),
  transports: [new winston.transports.Console()],
});

module.exports = logger;
