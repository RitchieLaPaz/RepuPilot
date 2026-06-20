const { migrate } = require('./index');

migrate()
  .then(() => process.exit(0))
  .catch((err) => { console.error(err); process.exit(1); });
