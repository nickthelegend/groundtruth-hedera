import { describe, it, expect, beforeAll } from 'vitest'

let hedera: typeof import('../lib/hedera')

beforeAll(async () => {
  process.env.HEDERA_NETWORK = 'hedera:testnet'
  process.env.PAYMENT_ASSET_ID = '0.0.0'
  hedera = await import('../lib/hedera')
})

describe('account id validation', () => {
  it('accepts well-formed ids', () => {
    for (const id of ['0.0.1', '0.0.9847867', '1.2.3']) {
      expect(hedera.isHederaAccountId(id)).toBe(true)
    }
  })

  it('rejects EVM addresses', () => {
    // The whole point of the port: worker identity is 0.0.x, not 0x…
    expect(hedera.isHederaAccountId('0xf566aaf0e2421c45fa280c59e0c46e5e898d1795')).toBe(false)
  })

  it('rejects malformed input', () => {
    for (const bad of ['', '0.0', '0.0.x', '..', 'null', '0.0.1;drop table tasks']) {
      expect(hedera.isHederaAccountId(bad)).toBe(false)
    }
  })
})

describe('normalizeAccountId', () => {
  it('trims surrounding whitespace a worker may paste', () => {
    expect(hedera.normalizeAccountId('  0.0.123  ')).toBe('0.0.123')
    expect(hedera.normalizeAccountId('\n0.0.123\t')).toBe('0.0.123')
  })

  it('strips a CAIP-style network prefix', () => {
    expect(hedera.normalizeAccountId('hedera:testnet:0.0.123')).toBe('0.0.123')
    expect(hedera.normalizeAccountId('hedera:mainnet0.0.123')).toBe('0.0.123')
  })

  it('throws on anything that is not an account id', () => {
    expect(() => hedera.normalizeAccountId('0xabc')).toThrow(/Not a Hedera account id/)
    expect(() => hedera.normalizeAccountId('')).toThrow()
  })
})

describe('transaction id conversion', () => {
  // HashScan uses 0.0.x@sec.nanos; mirror node uses 0.0.x-sec-nanos.
  const hashscan = '0.0.7162784@1785448933.726761986'
  const mirror = '0.0.7162784-1785448933-726761986'

  it('converts mirror form to HashScan form', () => {
    expect(hedera.toHashScanTxId(mirror)).toBe(hashscan)
  })

  it('converts HashScan form to mirror form', () => {
    expect(hedera.toMirrorTxId(hashscan)).toBe(mirror)
  })

  it('is idempotent when already in the target form', () => {
    expect(hedera.toHashScanTxId(hashscan)).toBe(hashscan)
    expect(hedera.toMirrorTxId(mirror)).toBe(mirror)
  })

  it('round-trips both directions', () => {
    expect(hedera.toMirrorTxId(hedera.toHashScanTxId(mirror))).toBe(mirror)
    expect(hedera.toHashScanTxId(hedera.toMirrorTxId(hashscan))).toBe(hashscan)
  })

  it('passes through unrecognised input rather than mangling it', () => {
    expect(hedera.toHashScanTxId('garbage')).toBe('garbage')
  })
})

describe('explorer links', () => {
  it('builds testnet HashScan URLs in the form HashScan expects', () => {
    expect(hedera.explorerTx('0.0.1-1700000000-123')).toBe(
      'https://hashscan.io/testnet/transaction/0.0.1@1700000000.123'
    )
    expect(hedera.explorerAccount('0.0.9847867')).toBe(
      'https://hashscan.io/testnet/account/0.0.9847867'
    )
    expect(hedera.explorerTopic('0.0.9847942')).toBe(
      'https://hashscan.io/testnet/topic/0.0.9847942'
    )
  })
})

describe('asset configuration', () => {
  it('derives HBAR settings from the 0.0.0 asset id', () => {
    expect(hedera.IS_HBAR).toBe(true)
    expect(hedera.PAYMENT_ASSET_DECIMALS).toBe(8)
    expect(hedera.PAYMENT_ASSET_SYMBOL).toBe('HBAR')
  })

  it('points at the right mirror node for the network', () => {
    expect(hedera.MIRROR_NODE_URL).toBe('https://testnet.mirrornode.hedera.com')
  })
})

describe('key parsing', () => {
  it('parses an ECDSA key', async () => {
    const { PrivateKey } = await import('@hiero-ledger/sdk')
    const generated = PrivateKey.generateECDSA()
    const parsed = hedera.parsePrivateKey(generated.toStringDer())
    expect(parsed.publicKey.toStringDer()).toBe(generated.publicKey.toStringDer())
  })

  it('falls back to ED25519 when the hint is absent', async () => {
    const { PrivateKey } = await import('@hiero-ledger/sdk')
    const previous = process.env.HEDERA_KEY_TYPE
    delete process.env.HEDERA_KEY_TYPE
    const generated = PrivateKey.generateED25519()
    const parsed = hedera.parsePrivateKey(generated.toStringDer())
    expect(parsed.publicKey.toStringDer()).toBe(generated.publicKey.toStringDer())
    if (previous) process.env.HEDERA_KEY_TYPE = previous
  })

  it('tolerates surrounding whitespace', async () => {
    const { PrivateKey } = await import('@hiero-ledger/sdk')
    const generated = PrivateKey.generateECDSA()
    expect(hedera.parsePrivateKey(`  ${generated.toStringDer()}  `).publicKey.toStringDer()).toBe(
      generated.publicKey.toStringDer()
    )
  })
})
