const a = require('./a');
const b = require(`./b`);
const c = require(name);
const d = require.resolve('./d');
const e = module.require('./e');
const f = obj.require('./f-method');
const { g } = require('./g'),
  h = require("./h");
if (typeof require === 'function') {}
const i = require('./i' + x);
