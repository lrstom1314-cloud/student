/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  // Argon2id 是原生模块，交给 Node 直接 require，不参与打包。
  serverExternalPackages: ["@node-rs/argon2"],
  experimental: {
    authInterrupts: true,
  },
};

export default nextConfig;
