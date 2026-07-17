//! CLI: read one JSON invoke request from stdin, write one JSON response to stdout.

use std::io::{self, Read, Write};
use std::process::ExitCode;

use shadow_invoker::{invoke, InvokeRequest};

#[tokio::main]
async fn main() -> ExitCode {
    match run().await {
        Ok(()) => ExitCode::SUCCESS,
        Err(message) => {
            let _ = writeln!(io::stderr(), "{message}");
            ExitCode::FAILURE
        }
    }
}

/// Read stdin JSON, invoke once, write stdout JSON.
async fn run() -> Result<(), String> {
    let mut stdin = String::new();
    io::stdin()
        .read_to_string(&mut stdin)
        .map_err(|err| format!("read stdin: {err}"))?;
    let request: InvokeRequest =
        serde_json::from_str(stdin.trim()).map_err(|err| format!("parse request JSON: {err}"))?;
    let response = invoke(request).await;
    let encoded =
        serde_json::to_string(&response).map_err(|err| format!("encode response JSON: {err}"))?;
    // Write once and flush so Node spawn pipe consumers see a complete JSON body.
    let mut stdout = io::stdout().lock();
    stdout
        .write_all(encoded.as_bytes())
        .map_err(|err| format!("write stdout: {err}"))?;
    stdout
        .write_all(b"\n")
        .map_err(|err| format!("write stdout newline: {err}"))?;
    stdout
        .flush()
        .map_err(|err| format!("flush stdout: {err}"))?;
    Ok(())
}
