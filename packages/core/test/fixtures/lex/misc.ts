@decorator('./not-an-import')
class A {
  #private = 1;
  static async *gen() { yield /x/; }
  method() { return this.#private?.toString() ?? 0; }
  import() { return 1; }
  require(path) { return path; }
}
const o = { import: 1, require: 2, export: 3 }; import('./m1');
const p = a?.5:1; import('./m2');
const q = 1_000n + 0x1F + .5e-3; import('./m3');
label: for (const x of xs) { break label; } import('./m4');
export default /regex/; import('./m5');
const r = x.import('./method'); import('./m6');
