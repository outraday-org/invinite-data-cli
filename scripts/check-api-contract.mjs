import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const source = JSON.parse(readFileSync(new URL('../api-contract.json', import.meta.url), 'utf8'));
const spec = readFileSync(new URL('../openapi.json', import.meta.url));
if (source.provenance.repository !== 'https://github.com/outraday-org/invinite-data-api')
  throw new Error('API contract has the wrong owner');
if (createHash('sha256').update(spec).digest('hex') !== source.provenance.specSha256)
  throw new Error('CLI OpenAPI differs from its versioned API contract; adopt a matching API reference bundle');
const { revision, fingerprint, ...provenance } = source.provenance;
if (!/^[a-f0-9]{40}$/u.test(revision)) throw new Error('API source revision is missing');
if (
  createHash('sha256')
    .update(JSON.stringify({ ...source, provenance }))
    .digest('hex') !== fingerprint
)
  throw new Error('API contract fingerprint is invalid');
console.log('CLI OpenAPI matches its versioned API owner contract');
