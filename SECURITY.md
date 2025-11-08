# Security Policy

## Supported Versions

We actively support the following versions with security updates:

| Version | Supported          |
| ------- | ------------------ |
| 1.x.x   | :white_check_mark: |
| < 1.0.0 | :x:                |

## Reporting a Vulnerability

If you discover a security vulnerability, please help us keep the SDK secure:

1. **Do not** open a public GitHub issue
2. Email the SolvaPay team at **contact@solvapay.com** with:
   - A description of the vulnerability
   - Steps to reproduce the issue
   - Any suggested fixes or mitigations

### What to Expect

- We'll acknowledge your report within **48 hours**
- We'll work with you to understand and fix the issue
- Once resolved, we'll credit you (if you'd like) and publish details
- We won't disclose the vulnerability publicly until a fix is ready

## Security Best Practices

When using the SolvaPay SDK:

- **Never expose your secret API keys in client-side code**
- Always use environment variables for sensitive configuration
- Keep your dependencies up to date
- Review and validate webhook signatures
- Use HTTPS for all API communications
- Follow the principle of least privilege for API key permissions

## Security Updates

Security updates are published as:

- Patch versions (e.g., `1.0.0` → `1.0.1`) for critical fixes
- Security advisories on GitHub
- Release notes in our [CHANGELOG.md](./CHANGELOG.md)

Thanks for helping keep SolvaPay SDK secure! 🔒
