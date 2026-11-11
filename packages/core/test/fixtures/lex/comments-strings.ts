#!/usr/bin/env node
/**
 * @type {import('./jsdoc-type').T}
 * require('./in-doc')
 */
// import x from './line-comment';
const url = 'http://example.com//not-a-comment'; import('./after-url');
const s1 = 'it\'s'; import('./after-escaped-quote');
const s2 = "say \"hi\""; import('./after-escaped-double');
const s3 = 'line \
continuation'; import('./after-continuation');
const t = import('./\u0061scii-escape');
const u = require('./\x62yte-escape');
const v = "import x from './in-string'";
