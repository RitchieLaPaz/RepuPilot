/**
 * Scanner entry point — call startScanner() on app boot
 */
const { runCycle, seedSeenCache } = require('./scheduler');
const logger = require('../lib/logger');

async function startScanner() {
  logger.info('Reddit scanner initializing...');
  // Small delay to ensure DB migration is fully committed
  await new Promise(r => setTimeout(r, 3000));
  await seedSeenCache();
  setTimeout(runCycle, 30 * 1000);
  logger.info('Reddit scanner scheduled');
}

module.exports = { startScanner, runCycle };
