import fc from 'fast-check';

// Property tests are seeded so every run, on every machine, explores the same cases.
// Set TROMMEL_FC_SEED to explore a different region; a failure prints the seed and path to replay.
const seed = Number.parseInt(process.env['TROMMEL_FC_SEED'] ?? '20261116', 10);
fc.configureGlobal({ seed });
