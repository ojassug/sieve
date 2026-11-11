import React, { lazy } from 'react';
const Lazy = lazy(() => import('./LazyPanel'));
export function App({ items }: { items: string[] }) {
  const isBig = items.length > 3 && items.length < 10;
  return (
    <div className="app" data-x='single "quoted"' title="it's // fine">
      <p>Don't panic, it's "fine" / great</p>
      {/* import('./in-jsx-comment') */}
      {items.map((item) => <Item key={item} label={`#${item}`} />)}
      <>
        <Lazy fallback={<span>Loading…</span>} />
        {isBig ? <b>big</b> : <i>small</i>}
      </>
      <a href="https://example.com">it's a link</a>
    </div>
  );
}
const identity = <T,>(value: T): T => value;
const bounded = <T extends object>(value: T) => value;
const Panel = lazy(() => import('./Panel'));
