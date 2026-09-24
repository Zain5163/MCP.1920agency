/** @type {import('next').NextConfig} */
export default {
  // The engine packages are workspace TypeScript sources, not built npm modules.
  transpilePackages: [
    '@social-publisher/core',
    '@social-publisher/adapters',
    '@social-publisher/publisher',
    '@social-publisher/vault',
    '@social-publisher/db',
    '@social-publisher/media',
    '@social-publisher/config',
  ],
  experimental: { serverActions: { bodySizeLimit: '25mb' } },
}
