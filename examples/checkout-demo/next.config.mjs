/** @type {import('next').NextConfig} */
/* global process */
const nextConfig = {
  env: {
    NEXT_PUBLIC_SOLVAPAY_PRODUCT_REF: process.env.SOLVAPAY_PRODUCT_REF,
  },
};

export default nextConfig;

