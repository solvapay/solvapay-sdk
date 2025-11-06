[**SolvaPay SDK**](../../../README.md)

***

[SolvaPay SDK](../../../modules.md) / [react/src](../README.md) / defaultAuthAdapter

# Variable: defaultAuthAdapter

> `const` **defaultAuthAdapter**: [`AuthAdapter`](../interfaces/AuthAdapter.md)

Defined in: [packages/react/src/adapters/auth.ts:45](https://github.com/solvapay/solvapay-sdk/blob/main/packages/react/src/adapters/auth.ts#L45)

Default auth adapter that only checks localStorage

This is a fallback adapter that doesn't depend on any specific auth provider.
It checks for a token in localStorage under the 'auth_token' key.
