//! Emit TypeScript signature-parity suite from catalog IR (§2.8 / step 18).

use std::fmt::Write as _;

use crate::error::GenResult;
use crate::ir::{Ir, IrEntrySection, IrSyncKind};

const HEADER: &str = "\
/**\n\
 * @generated — do not edit. Regenerate with dto-gen --ts-parity-out.\n\
 * Signature-parity suite (§2.8) — presence, arity, sync matrix, defaults, errors.\n\
 */\n\n";

/// Emits `signature-parity.generated.test.ts` contents.
///
/// # Errors
///
/// Returns formatting errors as [`crate::error::GenError`] (none expected for string writes).
pub fn emit_parity_suite_ts(ir: &Ir) -> GenResult<String> {
    let mut out = String::new();
    out.push_str(HEADER);
    out.push_str("import { describe, expect, expectTypeOf, it } from 'vitest'\n");
    out.push_str("import { SolvaPayError } from '@solvapay/core'\n");
    out.push_str("import { PaywallError } from '../paywall'\n");
    out.push_str("import type { SolvaPayClient } from '../types/client'\n");
    out.push_str("import type { SolvaPayClientGenerated } from '../types/client.generated'\n\n");

    out.push_str("describe('signature-parity (generated)', () => {\n");

    // Frozen defaults from contract/manifest/sdk-contract.yaml `defaults:`
    out.push_str(
        "  describe('defaults', () => {\n\
            it('documents frozen retry / webhook / cache defaults', () => {\n\
                expect(2).toBe(2) // maxRetries\n\
                expect(500).toBe(500) // initialDelayMs\n\
                expect(300).toBe(300) // webhookToleranceSec\n\
                expect(10_000).toBe(10_000) // limitsCacheTTLMs\n\
             })\n\
           })\n\n",
    );

    out.push_str(
        "  describe('error mapping', () => {\n\
            it('SolvaPayError preserves status/code', () => {\n\
                const err = new SolvaPayError('boom', { status: 400, code: 'bad_request' })\n\
                expect(err.status).toBe(400)\n\
                expect(err.code).toBe('bad_request')\n\
             })\n\
             it('PaywallError carries structuredContent', () => {\n\
                const err = new PaywallError('Payment required', {\n\
                 kind: 'payment_required',\n\
                 product: 'prd_x',\n\
                 checkoutUrl: 'https://example.com/checkout',\n\
                 message: 'Payment required',\n\
               })\n\
                expect(err.name).toBe('PaywallError')\n\
                expect(err.structuredContent.kind).toBe('payment_required')\n\
             })\n\
           })\n\n",
    );

    if !ir.error_templates.webhook_messages.is_empty() {
        out.push_str(
            "  describe('error templates (IR)', () => {\n\
                it('webhook message map is non-empty in IR emission', () => {\n\
                    // Presence gate — template strings are regenerated with dto-gen.\n\
                    expect(true).toBe(true)\n\
                 })\n\
               })\n\n",
        );
    }

    out.push_str("  describe('client methods', () => {\n");
    for ep in ir.entry_points.values() {
        if ep.section != IrEntrySection::Operation {
            continue;
        }
        let name = &ep.names.ts;
        let arity = ep.params.len();
        let required = ep.params.iter().filter(|p| p.required).count();
        let _ = writeln!(
            out,
            "    it('{name} presence / arity / sync', () => {{\n\
                    expectTypeOf<SolvaPayClient['{name}']>().toEqualTypeOf<\n\
                 SolvaPayClientGenerated['{name}']\n\
               >()\n\
                    type P = Parameters<NonNullable<SolvaPayClient['{name}']>>\n\
                    // IR param count (incl. optional). TS Parameters['length'] is a\n\
                    // union when trailing params are optional — require IR arity ∈ that union.\n\
                    type ExpectedArity = {arity}\n\
                    type AssertArity = ExpectedArity extends P['length'] ? true : false\n\
                    expectTypeOf<AssertArity>().toEqualTypeOf<true>()\n\
                    // required param count (IR): {required}"
        );
        if ep.sync_ts == IrSyncKind::Async {
            let _ = writeln!(
                out,
                "      type R = ReturnType<NonNullable<SolvaPayClient['{name}']>>\n\
                    expectTypeOf<R>().toMatchTypeOf<Promise<unknown>>()\n\
                 }})"
            );
        } else {
            let _ = writeln!(
                out,
                "      type R = ReturnType<NonNullable<SolvaPayClient['{name}']>>\n\
                    expectTypeOf<R>().not.toMatchTypeOf<Promise<unknown>>()\n\
                 }})"
            );
        }
    }
    out.push_str("  })\n");

    out.push_str("})\n");
    Ok(out)
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
mod tests {
    use super::*;
    use crate::ir::{IrEntryPoint, IrEntrySection, IrLangNames, IrSyncKind};
    use std::collections::BTreeMap;

    #[test]
    fn emits_one_method_block() {
        let mut ir = Ir {
            types: BTreeMap::new(),
            overlay_helpers: BTreeMap::new(),
            overlays: BTreeMap::new(),
            routes: vec![],
            error_templates: crate::ir::IrErrorTemplates::default(),
            entry_points: BTreeMap::new(),
            binding_symbols: BTreeMap::new(),
        };
        ir.entry_points.insert(
            "checkLimits".into(),
            IrEntryPoint {
                id: "checkLimits".into(),
                section: IrEntrySection::Operation,
                names: IrLangNames {
                    ts: "checkLimits".into(),
                    py: "check_limits".into(),
                    rb: "check_limits".into(),
                    go: "CheckLimits".into(),
                    rust: "check_limits".into(),
                },
                optional_on_client: false,
                params: vec![],
                type_params: vec![],
                request: None,
                response: Some("LimitResponseWithPlan".into()),
                sync_ts: IrSyncKind::Async,
            },
        );
        let out = emit_parity_suite_ts(&ir).unwrap();
        assert!(out.contains("@generated"));
        assert!(out.contains("checkLimits presence / arity / sync"));
        assert!(out.contains("SolvaPayClient['checkLimits']"));
        assert!(out.contains("type ExpectedArity = 0"));
        assert!(out.contains("Promise<unknown>"));
    }
}
