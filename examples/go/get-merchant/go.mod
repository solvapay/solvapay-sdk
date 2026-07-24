module github.com/solvapay/solvapay-sdk/examples/go/get-merchant

go 1.23

require github.com/solvapay/solvapay-go v0.0.0

require github.com/tetratelabs/wazero v1.9.0 // indirect

replace github.com/solvapay/solvapay-go => ../../../rust/bindings/go
