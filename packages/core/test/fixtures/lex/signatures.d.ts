interface Runner {
  import<T = any>(url: string): Promise<T>;
  import(id: string): Promise<unknown>;
  require(id?: string): unknown;
  require<T>(id: string): T;
}
declare const r: Runner; import('./after-signatures');
const pick = import(flag ? './a' : './b');
