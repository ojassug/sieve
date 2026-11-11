import def from './default';
import { a, b as c } from "./named";
import * as ns from './namespace';
import def2, { d } from './default-and-named';
import def3, * as ns2 from './default-and-namespace';
import {
  e,
  f as g,
} from './multi-line';
import { "string-name" as h } from './string-name';
import data from './data.json' with { type: 'json' };
import './side-effect';
import'./no-space';
export * from './star';
export * as star from './star-as';
export { i, j as k } from './reexport';
export { default } from './reexport-default';
export { l };
export const m = 1;
export default function n() {}
