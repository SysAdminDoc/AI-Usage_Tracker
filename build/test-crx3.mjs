import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { packCrx3, verifyCrx3 } from './crx3.mjs';

const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = keys.privateKey.export({ type: 'pkcs8', format: 'pem' });
const publicKey = keys.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
// Envelope tests use a labelled payload. Release ZIP contents are checked separately.
const payload = Buffer.from('PK test payload for signature verification');
const crx = packCrx3(payload, pem, publicKey);
assert.ok(verifyCrx3(crx, publicKey).zip.equals(payload));
assert.match(verifyCrx3(crx, publicKey).extensionId, /^[a-p]{32}$/);
const tampered = Buffer.from(crx);
tampered[tampered.length - 1] ^= 1;
assert.throws(() => verifyCrx3(tampered, publicKey), /signature/);
assert.throws(() => packCrx3(payload, pem, Buffer.from('wrong key').toString('base64')), /pinned manifest key/);
assert.throws(() => verifyCrx3(crx, Buffer.from('wrong key').toString('base64')), /does not match manifest/);
assert.throws(() => verifyCrx3(crx.subarray(0, 20), publicKey), /header length/);
const badMagic = Buffer.from(crx); badMagic[0] = 0;
assert.throws(() => verifyCrx3(badMagic, publicKey), /magic/);
const badVersion = Buffer.from(crx); badVersion.writeUInt32LE(2, 4);
assert.throws(() => verifyCrx3(badVersion, publicKey), /CRX3/);
console.log('CRX3 signature and tamper checks passed (8 assertions)');
