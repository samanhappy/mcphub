import crypto from 'node:crypto';

/**
 * A minimal WebAuthn authenticator for tests: one ES256 discoverable credential,
 * "none" attestation, user presence and verification always asserted. It builds
 * the same JSON a browser returns from @simplewebauthn/browser.
 */

type CborValue = number | string | Uint8Array | Map<CborValue, CborValue> | CborValue[];

const cborHead = (major: number, length: number): Buffer => {
  if (length < 24) return Buffer.from([(major << 5) | length]);
  if (length < 0x100) return Buffer.from([(major << 5) | 24, length]);
  if (length < 0x10000) return Buffer.from([(major << 5) | 25, length >> 8, length & 0xff]);
  const head = Buffer.alloc(5);
  head[0] = (major << 5) | 26;
  head.writeUInt32BE(length, 1);
  return head;
};

const encodeCbor = (value: CborValue): Buffer => {
  if (typeof value === 'number') {
    return value >= 0 ? cborHead(0, value) : cborHead(1, -1 - value);
  }
  if (typeof value === 'string') {
    const bytes = Buffer.from(value, 'utf8');
    return Buffer.concat([cborHead(3, bytes.length), bytes]);
  }
  if (value instanceof Uint8Array) {
    return Buffer.concat([cborHead(2, value.length), Buffer.from(value)]);
  }
  if (Array.isArray(value)) {
    return Buffer.concat([cborHead(4, value.length), ...value.map(encodeCbor)]);
  }
  const parts: Buffer[] = [cborHead(5, value.size)];
  for (const [key, item] of value) parts.push(encodeCbor(key), encodeCbor(item));
  return Buffer.concat(parts);
};

const b64url = (value: Uint8Array | string): string => Buffer.from(value).toString('base64url');
const sha256 = (value: Uint8Array | string): Buffer =>
  crypto.createHash('sha256').update(value).digest();

const FLAG_UP = 0x01;
const FLAG_UV = 0x04;
const FLAG_AT = 0x40;

export interface CeremonyOverrides {
  origin?: string;
  rpId?: string;
  challenge?: string;
  counter?: number;
}

export class SoftwareAuthenticator {
  readonly credentialId = crypto.randomBytes(16);
  private readonly keys = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  private userHandle?: string;
  counter = 0;

  constructor(private readonly origin: string) {}

  get id(): string {
    return b64url(this.credentialId);
  }

  private cosePublicKey(): Buffer {
    const jwk = this.keys.publicKey.export({ format: 'jwk' });
    return encodeCbor(
      new Map<CborValue, CborValue>([
        [1, 2],
        [3, -7],
        [-1, 1],
        [-2, Buffer.from(jwk.x!, 'base64url')],
        [-3, Buffer.from(jwk.y!, 'base64url')],
      ]),
    );
  }

  private clientData(type: string, challenge: string, origin: string): Buffer {
    return Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
  }

  /** Answers `navigator.credentials.create()` for the given registration options. */
  register(
    options: { challenge: string; rp: { id?: string }; user: { id: string } },
    overrides: CeremonyOverrides = {},
  ) {
    this.userHandle = options.user.id;
    const rpId = overrides.rpId ?? options.rp.id!;
    const idLength = Buffer.alloc(2);
    idLength.writeUInt16BE(this.credentialId.length);
    const authData = Buffer.concat([
      sha256(rpId),
      Buffer.from([FLAG_UP | FLAG_UV | FLAG_AT]),
      Buffer.alloc(4),
      Buffer.alloc(16),
      idLength,
      this.credentialId,
      this.cosePublicKey(),
    ]);
    const attestationObject = encodeCbor(
      new Map<CborValue, CborValue>([
        ['fmt', 'none'],
        ['attStmt', new Map()],
        ['authData', authData],
      ]),
    );
    const clientDataJSON = this.clientData(
      'webauthn.create',
      overrides.challenge ?? options.challenge,
      overrides.origin ?? this.origin,
    );
    return {
      id: this.id,
      rawId: this.id,
      type: 'public-key',
      response: {
        clientDataJSON: b64url(clientDataJSON),
        attestationObject: b64url(attestationObject),
        transports: ['internal'],
      },
      clientExtensionResults: {},
    };
  }

  /** Answers `navigator.credentials.get()` for the given authentication options. */
  authenticate(options: { challenge: string; rpId?: string }, overrides: CeremonyOverrides = {}) {
    const rpId = overrides.rpId ?? options.rpId!;
    this.counter = overrides.counter ?? this.counter + 1;
    const counter = Buffer.alloc(4);
    counter.writeUInt32BE(this.counter);
    const authenticatorData = Buffer.concat([
      sha256(rpId),
      Buffer.from([FLAG_UP | FLAG_UV]),
      counter,
    ]);
    const clientDataJSON = this.clientData(
      'webauthn.get',
      overrides.challenge ?? options.challenge,
      overrides.origin ?? this.origin,
    );
    const signature = crypto.sign(
      'sha256',
      Buffer.concat([authenticatorData, sha256(clientDataJSON)]),
      this.keys.privateKey,
    );
    return {
      id: this.id,
      rawId: this.id,
      type: 'public-key',
      response: {
        clientDataJSON: b64url(clientDataJSON),
        authenticatorData: b64url(authenticatorData),
        signature: b64url(signature),
        userHandle: this.userHandle,
      },
      clientExtensionResults: {},
    };
  }
}
