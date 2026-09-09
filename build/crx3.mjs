import assert from 'node:assert/strict';
import { createHash, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';

const context = Buffer.from('CRX3 SignedData\0');
const u32 = value => { const bytes = Buffer.alloc(4); bytes.writeUInt32LE(value); return bytes; };
const varint = value => {
  const bytes = [];
  do { const byte = value & 127; value = Math.floor(value / 128); bytes.push(byte | (value ? 128 : 0)); } while (value);
  return Buffer.from(bytes);
};
const field = (id, bytes) => Buffer.concat([varint(id * 8 + 2), varint(bytes.length), bytes]);
const signedBytes = (header, zip) => Buffer.concat([context, u32(header.length), header, zip]);

export function packCrx3(zip, pem, expectedPublicKey) {
  const privateKey = createPrivateKey(pem);
  assert.equal(privateKey.asymmetricKeyType, 'rsa', 'An RSA signing key is required');
  const publicKey = createPublicKey(privateKey).export({ type: 'spki', format: 'der' });
  assert.ok(publicKey.equals(Buffer.from(expectedPublicKey, 'base64')), 'Signing key does not match the pinned manifest key');
  const id = createHash('sha256').update(publicKey).digest().subarray(0, 16);
  const signedHeader = field(1, id);
  const signature = sign('sha256', signedBytes(signedHeader, zip), privateKey);
  const proof = Buffer.concat([field(1, publicKey), field(2, signature)]);
  const header = Buffer.concat([field(2, proof), field(10000, signedHeader)]);
  const result = Buffer.concat([Buffer.from('Cr24'), u32(3), u32(header.length), header, zip]);
  verifyCrx3(result, expectedPublicKey);
  return result;
}

function fields(bytes) {
  const result = new Map();
  let offset = 0;
  const readVarint = () => {
    let value = 0;
    for (let shift = 0; shift < 35; shift += 7) {
      assert.ok(offset < bytes.length, 'Truncated protobuf varint');
      const byte = bytes[offset++];
      value += (byte & 127) * 2 ** shift;
      if (!(byte & 128)) return value;
    }
    throw new Error('Oversized protobuf varint');
  };
  while (offset < bytes.length) {
    const tag = readVarint();
    assert.equal(tag % 8, 2, 'Unexpected protobuf wire type');
    const length = readVarint();
    assert.ok(offset + length <= bytes.length, 'Truncated protobuf field');
    const id = Math.floor(tag / 8);
    assert.ok(!result.has(id), 'Duplicate protobuf field');
    result.set(id, bytes.subarray(offset, offset + length));
    offset += length;
  }
  return result;
}

export function verifyCrx3(bytes, expectedPublicKey) {
  assert.ok(bytes.length > 12, 'Truncated CRX');
  assert.equal(bytes.subarray(0, 4).toString(), 'Cr24', 'Invalid CRX magic');
  assert.equal(bytes.readUInt32LE(4), 3, 'CRX3 is required');
  const end = 12 + bytes.readUInt32LE(8);
  assert.ok(end < bytes.length, 'Invalid CRX header length');
  const header = fields(bytes.subarray(12, end));
  assert.ok(header.has(2) && header.has(10000), 'Missing CRX proof or signed header');
  const proof = fields(header.get(2));
  const signedHeader = header.get(10000);
  const id = fields(signedHeader).get(1);
  const publicKey = proof.get(1);
  assert.ok(publicKey && proof.get(2) && id, 'Incomplete CRX signing data');
  assert.ok(publicKey.equals(Buffer.from(expectedPublicKey, 'base64')), 'CRX public key does not match manifest');
  assert.ok(id.equals(createHash('sha256').update(publicKey).digest().subarray(0, 16)), 'CRX ID does not match signing key');
  const zip = bytes.subarray(end);
  assert.equal(zip.subarray(0, 2).toString(), 'PK', 'ZIP payload is missing');
  assert.ok(verify('sha256', signedBytes(signedHeader, zip), { key: publicKey, type: 'spki', format: 'der' }, proof.get(2)), 'CRX signature verification failed');
  return { zip, extensionId: [...id].flatMap(byte => [byte >> 4, byte & 15]).map(n => String.fromCharCode(97 + n)).join('') };
}
