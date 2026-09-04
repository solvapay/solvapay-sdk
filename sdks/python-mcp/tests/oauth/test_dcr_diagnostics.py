from solvapay_mcp.oauth.dcr_diagnostics import dcr_failure_diagnostic


def test_invalid_identifier_body_yields_unresolved_product_hint() -> None:
    message = dcr_failure_diagnostic(
        product_ref="prd_missing",
        api_base_url="https://api-dev.solvapay.com",
        status=400,
        body_text=(
            "Invalid identifier. Use mcp_server_id for Managed MCP, "
            "or product_ref for SDK-integrated MCP."
        ),
    )
    assert "prd_missing" in message
    assert "api-dev.solvapay.com" in message
    assert "did not resolve" in message.lower()


def test_unrelated_body_yields_generic_hint() -> None:
    message = dcr_failure_diagnostic(
        product_ref="prd_x",
        api_base_url="https://api.solvapay.com",
        status=500,
        body_text="internal error",
    )
    assert "OAuth DCR failed (500)" in message
    assert "doctor" in message
    assert "did not resolve" not in message.lower()
