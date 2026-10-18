const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const root = path.resolve(__dirname, '..');
const relative = 'test/e01-intentional-failure.test.js';
const probe = path.join(root, relative);
if (fs.existsSync(probe)) throw new Error('Refusing to overwrite an existing temporary probe');
const text = `const { expect } = require('chai');
const { writeEvidence } = require('./helpers/v2-evidence-reporter');
const names = { E01: 'E01 intentional reporter failure probe' };
describe('E01 generated failure-record proof', function () {
  it(names.E01, function () { expect(false, 'intentional E-01 failure probe').to.equal(true); });
  after(function () {
    writeEvidence({ suite: this.test.parent, names, outputPath: 'docs/e01-intentional-failure.json', command: 'npx hardhat test --no-compile --config hardhat.v2.config.js --network hardhat ${relative}', testFile: '${relative}' });
  });
});
`;
const sourceSnapshot = path.join(root, 'docs/e01-intentional-failure-source.txt');
fs.writeFileSync(sourceSnapshot, text);
fs.writeFileSync(probe, text);
let run;
try {
  run = spawnSync(process.execPath, [path.join(root, 'node_modules/hardhat/internal/cli/cli.js'), 'test', '--no-compile', '--config', 'hardhat.v2.config.js', '--network', 'hardhat', relative], { cwd: root, encoding: 'utf8' });
  fs.writeFileSync(path.join(root, 'docs/e01-intentional-failure.log'), `${run.stdout || ''}\n${run.stderr || ''}`);
  const evidence = JSON.parse(fs.readFileSync(path.join(root, 'docs/e01-intentional-failure.json'), 'utf8'));
  if (run.error || run.status !== 1 || evidence.findings.length !== 1 || evidence.findings[0].status !== 'fail' || !evidence.findings[0].error.includes('intentional E-01 failure probe')) throw new Error(`Failure recording was not proven: ${run.error || run.status}`);
} finally {
  if (fs.existsSync(probe)) {
    if (fs.readFileSync(probe, 'utf8') !== text) throw new Error('Probe changed unexpectedly; refusing removal');
    fs.unlinkSync(probe);
  }
}
const result = { exitCode: run.status, removedTemporaryTest: !fs.existsSync(probe), sourceSnapshot: path.relative(root, sourceSnapshot), sourceSha256: crypto.createHash('sha256').update(text).digest('hex'), report: 'docs/e01-intentional-failure.json', log: 'docs/e01-intentional-failure.log' };
fs.writeFileSync(path.join(root, 'docs/e01-intentional-failure-provenance.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
