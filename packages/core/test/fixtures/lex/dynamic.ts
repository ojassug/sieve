const a = import('./literal');
const b = import(`./template-literal`);
const c = import(`./tpl/${name}.ts`);
const d = import(name);
const e = await import('./awaited');
const f = import('./with-options', { with: { type: 'json' } });
obj.import('./method-not-import');
type T = typeof import('./type-position');
// import('./in-comment');
/* import('./in-block-comment') */
const s = "import('./in-string')";
const g = import(
  './multi-line-call'
);
const h = import('./a' + suffix);
