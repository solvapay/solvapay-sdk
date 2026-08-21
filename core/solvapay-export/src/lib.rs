//! Inert `#[solvapay_export]` marker for dto-gen.
//!
//! Rust has no stable user-definable inert attributes, so this pass-through
//! proc-macro exists only to make the attribute compile. dto-gen reads the
//! tokens with `syn`; the compiler leaves the item unchanged.

use proc_macro::TokenStream;

/// Pass-through export marker. Arguments are for dto-gen, not the compiler.
#[proc_macro_attribute]
pub fn solvapay_export(_attr: TokenStream, item: TokenStream) -> TokenStream {
    item
}
