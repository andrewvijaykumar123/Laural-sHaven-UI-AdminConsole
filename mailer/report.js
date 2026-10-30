'use strict';
const { loadCore, dailyReport, targetDay } = require('./lib');
const { connect, transport, SENDER } = require('./io');

(async () => {
  const day = /^\d{4}-\d{2}-\d{2}$/.test(process.env.REPORT_DATE || '') ? process.env.REPORT_DATE : targetDay(Date.now());
  await dailyReport({ store: connect(), send: transport(), LH: loadCore(), to: SENDER, day });
  process.exit(0);
})().catch((e) => { const why = [e && e.code, e && e.responseCode, e && e.message].filter(Boolean).join(' | ').replace(/[\r\n]+/g, ' ').slice(0, 200) || 'error'; console.error('::error title=report::report failed: ' + why); process.exit(1); });
