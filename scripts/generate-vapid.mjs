import { generateKeyPairSync } from 'node:crypto';

function fromBase64Url(value) {
  return Buffer.from(value, 'base64url');
}

const { publicKey, privateKey } = generateKeyPairSync('ec', {
  namedCurve: 'prime256v1',
});
const publicJwk = publicKey.export({ format: 'jwk' });
const privateJwk = privateKey.export({ format: 'jwk' });

if (!publicJwk.x || !publicJwk.y || !privateJwk.d) {
  throw new Error('Could not export the P-256 VAPID key pair');
}

const uncompressedPublicKey = Buffer.concat([
  Buffer.from([0x04]),
  fromBase64Url(publicJwk.x),
  fromBase64Url(publicJwk.y),
]);

console.log(`VAPID_PUBLIC_KEY=${uncompressedPublicKey.toString('base64url')}`);
console.log(`VAPID_PRIVATE_KEY=${privateJwk.d}`);
