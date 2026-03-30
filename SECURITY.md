# Security Policy

## Supported Versions

| Version | Supported |
|---|---|
| 0.3.x | Yes |
| 0.2.x | Yes |
| < 0.2 | No |

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Email us at **security@stratum-hq.org** with:

- A description of the vulnerability and its potential impact
- Steps to reproduce or a proof-of-concept
- Any relevant logs, screenshots, or code snippets

### What to Expect

- **Acknowledgment** within 48 hours confirming receipt
- **Status update** within 7 days with an initial assessment
- **Fix timeline** communicated once the issue is confirmed — critical issues are prioritized for rapid patching
- **Credit** in the release notes if you wish to be acknowledged

We ask that you give us reasonable time to address the issue before any public disclosure.

## Scope

The following are considered in-scope vulnerabilities:

- Authentication or authorization bypass
- Sensitive data leakage (credentials, session tokens, user data)
- SQL injection or other injection attacks
- Cryptographic weaknesses (key derivation, token generation)
- Remote code execution
- Privilege escalation

Out of scope: issues in dependencies (report those upstream), theoretical vulnerabilities without a realistic attack path, and issues in unsupported versions.
