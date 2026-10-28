'use strict';
const { loadCore, sweep } = require('./lib');
const { connect, transport } = require('./io');

(async () => {
  const stats = await sweep({ store: connect(), send: transport(), LH: loadCore() });
  console.log(JSON.stringify(stats));
  process.exit(stats.failed && !stats.sent ? 1 : 0);
})().catch((e) => { console.error('mailer failed:', e && e.code || e && e.message || 'error'); process.exit(1); });
