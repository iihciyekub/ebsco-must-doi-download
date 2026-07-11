import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPdfUrl,
  buildSearchUrl,
  extractDois,
  extractRecordId,
  normalizeDoi,
  pdfFilename
} from '../src/helpers.mjs';

test('extracts, cleans and deduplicates DOI values from TXT/CSV text', () => {
  const text = [
    'title,doi,notes',
    'Queueing,10.1287/msom.2022.1170.,first',
    'Duplicate,https://doi.org/10.1287/MSOM.2022.1170,again',
    'Quoted,"doi: 10.1000/xyz_(123)",ok',
    'Encoded,https://doi.org/10.5555%2Fabc-123; trailing'
  ].join('\n');
  assert.deepEqual(extractDois(text), [
    '10.1287/msom.2022.1170',
    '10.1000/xyz_(123)',
    '10.5555/abc-123'
  ]);
});

test('normalizes plain and URL DOI values', () => {
  assert.equal(normalizeDoi('  DOI: 10.1287/msom.2022.1170 '), '10.1287/msom.2022.1170');
  assert.equal(normalizeDoi('https://doi.org/10.1287/msom.2022.1170'), '10.1287/msom.2022.1170');
  assert.throws(() => normalizeDoi('not-a-doi'), /无效 DOI/);
});

test('builds the expected search URL', () => {
  const url = new URL(buildSearchUrl('10.1287/msom.2022.1170'));
  assert.equal(url.pathname, '/c/6dso22/search/advanced-results');
  assert.equal(url.searchParams.get('q'), '10.1287/msom.2022.1170');
  assert.equal(url.searchParams.get('limiters'), 'FT:Y');
});

test('extracts the record id from a relative result href', () => {
  const href = '/c/6dso22/search/details/i7t4wbcjoj?db=bsu&limiters=FT%3AY';
  assert.equal(extractRecordId(href), 'i7t4wbcjoj');
  assert.equal(
    extractRecordId('https://research-ebsco-com.libezproxy.must.edu.mo/c/random/search/details/aB9_x-2?q=doi'),
    'aB9_x-2'
  );
  assert.throws(() => extractRecordId('/something/else'), /无法.*提取/);
  assert.throws(() => extractRecordId('/search/details/%2Fetc%2Fpasswd'), /格式异常/);
});

test('builds PDF URL and safe DOI filename', () => {
  const url = new URL(buildPdfUrl('i7t4wbcjoj'));
  assert.equal(url.pathname, '/api/search/v1/record/i7t4wbcjoj/fulltext/pdf');
  assert.equal(url.searchParams.get('sourceRecordId'), 'i7t4wbcjoj');
  assert.equal(pdfFilename('10.1287/msom.2022.1170'), '10.1287_msom.2022.1170.pdf');
});
