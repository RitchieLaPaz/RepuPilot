/**
 * Scanner entry point — call startScanner() on app boot
 */
const { runCycle, seedSeenCache } = require('./scheduler');
const logger = require('../lib/logger');

async function startScanner() {
  logger.info('Reddit scanner initializing...');
  await seedSeenCache();
  // First cycle after 30s delay (let app fully boot first)
  setTimeout(runCycle, 30 * 1000);
  logger.info('Reddit scanner scheduled');
}

module.exports = { startScanner, runCycle };
