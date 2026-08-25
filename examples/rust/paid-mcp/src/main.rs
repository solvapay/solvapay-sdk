//! CLI for the paid-MCP example (`--gate` selects the paywall path).

use solvapay_example_paid_mcp::run;

#[tokio::main]
async fn main() {
    let args: Vec<String> = std::env::args().collect();
    let gate = args.iter().any(|a| a == "--gate");
    let message = args
        .windows(2)
        .find(|w| w[0] == "--message")
        .map(|w| w[1].as_str())
        .unwrap_or("hello");
    match run(!gate, message).await {
        Ok(result) => {
            match serde_json::to_string_pretty(&result) {
                Ok(text) => println!("{text}"),
                Err(err) => {
                    eprintln!("{err}");
                    std::process::exit(1);
                }
            }
        }
        Err(err) => {
            eprintln!("{err}");
            std::process::exit(1);
        }
    }
}
