import { strict as assert } from 'node:assert'
import { describe, test } from 'node:test'

import { blockedAddressReason, checkPublicUrl, createSafeFetch, SafeHttpError, type Connector } from '../src/safe-http.ts'

/**
 * The SSRF guard. The hosted server fetches addresses customers type in, from
 * inside a network that holds its database and the cloud metadata service. Each
 * test here is a way that has been used to reach such places.
 */

describe('which addresses are public', () => {
  test('private, loopback, link-local, metadata and reserved addresses are refused', () => {
    for (const ip of [
      '127.0.0.1', '127.8.8.8', '10.0.0.5', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1',
      '0.0.0.0', '224.0.0.1', '255.255.255.255', '198.18.0.1', '192.0.2.10',
      '::', '::1', 'fe80::1', 'fe80::1%eth0', 'fd00:ec2::254', 'fc00::1', 'ff02::1', '2001:db8::1',
      '::ffff:127.0.0.1', '::ffff:a9fe:a9fe', '::ffff:10.0.0.1', '64:ff9b::a9fe:a9fe', '2002:0a00:0001::1', '2001::1', '::127.0.0.1',
    ]) {
      assert.ok(blockedAddressReason(ip) !== undefined, `${ip} should be refused`)
    }
  })

  test('public addresses are allowed', () => {
    for (const ip of ['93.184.216.34', '1.1.1.1', '8.8.8.8', '172.32.0.1', '2606:4700:4700::1111', '2a00:1450:4001:80b::200e', '::ffff:8.8.8.8', '64:ff9b::808:808']) {
      assert.equal(blockedAddressReason(ip), undefined, ip)
    }
  })

  test('the metadata address is named for what it is', () => {
    assert.match(blockedAddressReason('169.254.169.254')!, /link-local|metadata/)
  })

  test('garbage is refused, not allowed', () => {
    for (const ip of ['999.1.1.1', 'not-an-ip', '1.2.3', ':::1']) assert.ok(blockedAddressReason(ip) !== undefined, ip)
  })
})

describe('the shape of an address', () => {
  const refused = (raw: string) => {
    const r = checkPublicUrl(raw)
    assert.ok(!(r instanceof URL), `${raw} should be refused`)
    return r.error
  }
  test('http is refused with the reason and the fix', () => {
    const why = refused('http://www.example.com')
    assert.match(why, /https/)
    assert.match(why, /certificate|HTTPS on/)
  })
  test('other ports, credentials in the URL and internal names are refused', () => {
    assert.match(refused('https://www.example.com:8080/'), /port 8080/)
    assert.match(refused('https://admin:pw@www.example.com/'), /username or password/)
    assert.match(refused('https://localhost/'), /public internet name/)
    assert.match(refused('https://intranet/'), /public internet name/)
    assert.match(refused('https://wp.local/'), /public internet name/)
    assert.match(refused('https://10.0.0.5/'), /private network/)
    assert.match(refused('https://[::1]/'), /loopback/)
  })
  test('a normal https address passes', () => {
    assert.ok(checkPublicUrl('https://www.example.com/blog') instanceof URL)
  })
})

describe('the guarded fetch', () => {
  const PUBLIC = '93.184.216.34'
  function harness(dns: Record<string, string[]>, answer: (url: URL, headers: Readonly<Record<string, string>>) => { status: number; headers?: Record<string, string>; body?: string }) {
    const lookups: string[] = []
    const connections: Array<{ host: string; address: string; headers: Readonly<Record<string, string>> }> = []
    const connect: Connector = async (t) => {
      connections.push({ host: t.url.hostname, address: t.address, headers: t.headers })
      const a = answer(t.url, t.headers)
      return { status: a.status, headers: a.headers ?? {}, body: Buffer.from(a.body ?? '') }
    }
    const fetch = createSafeFetch({
      resolver: async (host) => {
        lookups.push(host)
        const list = dns[host]
        if (list === undefined) throw Object.assign(new Error('not found'), { code: 'ENOTFOUND' })
        return list.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }))
      },
      connect,
    })
    return { fetch, lookups, connections }
  }
  const rejects = async (p: Promise<unknown>, kind: string, re?: RegExp) => {
    await assert.rejects(p, (e: unknown) => {
      assert.ok(e instanceof SafeHttpError, String(e))
      assert.equal(e.kind, kind, e.message)
      if (re !== undefined) assert.match(e.message, re)
      return true
    })
  }

  test('a name that resolves to a private address is refused before any connection', async () => {
    const h = harness({ 'evil.example.com': ['10.0.0.5'] }, () => ({ status: 200 }))
    await rejects(h.fetch({ url: 'https://evil.example.com/wp-json/' }), 'blocked_address', /private network/)
    assert.equal(h.connections.length, 0)
  })

  test('a name with one private answer among public ones is refused (DNS rebinding)', async () => {
    const h = harness({ 'rebind.example.com': [PUBLIC, '127.0.0.1'] }, () => ({ status: 200 }))
    await rejects(h.fetch({ url: 'https://rebind.example.com/' }), 'blocked_address', /loopback/)
    assert.equal(h.connections.length, 0)
  })

  test('the connection goes to the address that was checked', async () => {
    const h = harness({ 'www.example.com': [PUBLIC] }, () => ({ status: 200, body: 'ok' }))
    const res = await h.fetch({ url: 'https://www.example.com/wp-json/' })
    assert.equal(res.status, 200)
    assert.deepEqual(h.connections.map((c) => c.address), [PUBLIC])
  })

  test('http and localhost are refused without resolving', async () => {
    const h = harness({}, () => ({ status: 200 }))
    await rejects(h.fetch({ url: 'http://www.example.com/' }), 'insecure_url', /https/)
    await rejects(h.fetch({ url: 'https://localhost/' }), 'insecure_url')
    await rejects(h.fetch({ url: 'https://169.254.169.254/latest/meta-data/' }), 'insecure_url', /link-local/)
    assert.equal(h.lookups.length, 0)
    assert.equal(h.connections.length, 0)
  })

  test('a redirect to another host is refused and names where it went', async () => {
    const h = harness({ 'example.com': [PUBLIC], 'www.example.com': [PUBLIC] }, () => ({ status: 301, headers: { location: 'https://www.example.com/wp-json/' } }))
    await rejects(h.fetch({ url: 'https://example.com/wp-json/', headers: { authorization: 'Basic x' } }), 'redirect', /connect that address instead/)
    assert.equal(h.connections.length, 1, 'the login never went to the second host')
  })

  test('a redirect to a private host is refused, even where public redirects are allowed', async () => {
    const h = harness({ 'cdn.example.com': [PUBLIC], 'inside.example.com': ['192.168.0.10'] }, (url) =>
      url.hostname === 'cdn.example.com' ? { status: 302, headers: { location: 'https://inside.example.com/secret' } } : { status: 200 },
    )
    await rejects(h.fetch({ url: 'https://cdn.example.com/a.jpg', redirects: 'public' }), 'blocked_address')
    assert.equal(h.connections.length, 1)
  })

  test('a redirect to plain http is refused', async () => {
    const h = harness({ 'www.example.com': [PUBLIC] }, () => ({ status: 302, headers: { location: 'http://www.example.com/wp-json/' } }))
    await rejects(h.fetch({ url: 'https://www.example.com/wp-json/' }), 'redirect')
  })

  test('a same-host redirect is followed, and the name is checked again on each hop', async () => {
    let n = 0
    const h = harness({ 'www.example.com': [PUBLIC] }, () => (n++ === 0 ? { status: 301, headers: { location: '/wp-json/' } } : { status: 200, body: '{}' }))
    const res = await h.fetch({ url: 'https://www.example.com/wp-json' })
    assert.equal(res.status, 200)
    assert.equal(res.url, 'https://www.example.com/wp-json/')
    assert.equal(h.lookups.length, 2)
  })

  test('a public redirect for a download drops any login header', async () => {
    const h = harness({ 'a.example.com': [PUBLIC], 'b.example.com': [PUBLIC] }, (url) =>
      url.hostname === 'a.example.com' ? { status: 302, headers: { location: 'https://b.example.com/x.png' } } : { status: 200 },
    )
    await h.fetch({ url: 'https://a.example.com/x.png', redirects: 'public', headers: { authorization: 'Basic secret' } })
    assert.equal(h.connections[1]!.headers.authorization, undefined)
  })

  test('a change is never re-sent to where a redirect points', async () => {
    const h = harness({ 'www.example.com': [PUBLIC] }, () => ({ status: 307, headers: { location: '/other' } }))
    await rejects(h.fetch({ url: 'https://www.example.com/wp-json/wp/v2/pages/1', method: 'POST', body: '{}' }), 'redirect')
    assert.equal(h.connections.length, 1)
  })

  test('redirect loops stop', async () => {
    const h = harness({ 'www.example.com': [PUBLIC] }, (url) => ({ status: 302, headers: { location: `${url.pathname}x` } }))
    await rejects(h.fetch({ url: 'https://www.example.com/a' }), 'redirect', /more than 3/)
  })

  test('a name that does not exist says to check the spelling', async () => {
    const h = harness({}, () => ({ status: 200 }))
    await rejects(h.fetch({ url: 'https://no-such-site.example.com/' }), 'dns', /spelt|expired/)
  })
})
