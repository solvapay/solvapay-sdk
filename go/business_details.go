package solvapay

// Business purchase details, checked and normalised as @solvapay/core's
// validateBusinessDetails does (packages/core/src/business-details.ts, a zod
// schema). The tax-ID tables are generated from the TypeScript source by
// go/scripts/tax_ids.mjs, so both SDKs accept and reject the same input.

//go:generate node scripts/tax_ids.mjs

import (
	"fmt"
	"strings"
)

// CustomerNameMax is the longest customer name accepted, in UTF-16 code units as JavaScript counts.
const CustomerNameMax = 100

// BusinessDetailsInput is what a buyer entered. An empty string is a field
// left out; surrounding whitespace is trimmed.
type BusinessDetailsInput struct {
	IsBusiness         bool
	BusinessName       string
	Country            string // the business's country; required when IsBusiness
	CustomerCountry    string // the billing country
	CustomerName       string
	CustomerState      string
	CustomerPostalCode string
	TaxID              string
	TaxIDType          string // checked against TaxIDTypes when set; the output derives its own
}

// BusinessDetails is what to send the API: trimmed, countries upper-cased,
// the tax ID without spaces and with its type.
type BusinessDetails struct {
	IsBusiness         bool   `json:"isBusiness"`
	Country            string `json:"country,omitempty"`
	CustomerCountry    string `json:"customerCountry,omitempty"`
	BusinessName       string `json:"businessName,omitempty"`
	TaxID              string `json:"taxId,omitempty"`
	TaxIDType          string `json:"taxIdType,omitempty"`
	CustomerName       string `json:"customerName,omitempty"`
	CustomerState      string `json:"customerState,omitempty"`
	CustomerPostalCode string `json:"customerPostalCode,omitempty"`
}

// IsBuyerCountry reports whether Stripe Tax calculates tax for country as a buyer's country.
func IsBuyerCountry(country string) bool {
	return buyerCountries[strings.ToUpper(jsTrim(country))]
}

// NormalizeTaxID trims and upper-cases a tax ID and removes its whitespace.
func NormalizeTaxID(taxID string) string {
	return strings.Map(func(r rune) rune {
		if isJSWhitespace(r) {
			return -1
		}
		return r
	}, strings.ToUpper(jsTrim(taxID)))
}

// IsValidTaxIDForCountry reports whether taxID has the format country's tax-ID type requires.
func IsValidTaxIDForCountry(country, taxID string) bool {
	taxIDType, ok := countryToTaxIDType[country]
	if !ok {
		return false
	}
	normalized := NormalizeTaxID(taxID)
	if taxIDType == "eu_vat" && euMemberCountries[country] {
		return euVATFormatByCountry[country].MatchString(normalized)
	}
	return taxIDFormatByType[taxIDType].MatchString(normalized)
}

func invalidBusinessDetails(message string) *Error {
	return &Error{Code: "invalid_business_details", Status: 400, Message: message}
}

// ValidateBusinessDetails checks input and returns the details to send. On
// a problem it returns an *Error with code invalid_business_details and
// status 400, whose Message is the first problem, as TypeScript reports it.
func ValidateBusinessDetails(input BusinessDetailsInput) (BusinessDetails, error) {
	// The schema's field checks run first; its refinements only when they pass.
	if jsLength(input.CustomerName) > CustomerNameMax {
		return BusinessDetails{}, invalidBusinessDetails(fmt.Sprintf("Too big: expected string to have <=%d characters", CustomerNameMax))
	}
	if input.TaxIDType != "" && !contains(TaxIDTypes, input.TaxIDType) {
		quoted := make([]string, len(TaxIDTypes))
		for i, t := range TaxIDTypes {
			quoted[i] = `"` + t + `"`
		}
		return BusinessDetails{}, invalidBusinessDetails("Invalid option: expected one of " + strings.Join(quoted, "|"))
	}

	name := jsTrim(input.CustomerName)
	state := jsTrim(input.CustomerState)
	postalCode := jsTrim(input.CustomerPostalCode)
	billingCountry := strings.ToUpper(jsTrim(input.CustomerCountry))

	if !input.IsBusiness {
		if billingCountry != "" && !IsBuyerCountry(billingCountry) {
			return BusinessDetails{}, invalidBusinessDetails("Billing country is not supported for tax calculation")
		}
		if billingCountry == "" {
			return BusinessDetails{IsBusiness: false, CustomerName: name}, nil
		}
		return BusinessDetails{
			IsBusiness:         false,
			CustomerCountry:    billingCountry,
			CustomerName:       name,
			CustomerState:      state,
			CustomerPostalCode: postalCode,
		}, nil
	}

	country := strings.ToUpper(jsTrim(input.Country))
	if country == "" {
		return BusinessDetails{}, invalidBusinessDetails("Country is required")
	}
	if !IsBuyerCountry(country) {
		return BusinessDetails{}, invalidBusinessDetails("Country is not supported for business purchases")
	}
	hasTaxID := jsTrim(input.TaxID) != ""
	if hasTaxID && !IsValidTaxIDForCountry(country, input.TaxID) {
		return BusinessDetails{}, invalidBusinessDetails("Enter a valid tax ID for " + country)
	}

	details := BusinessDetails{
		IsBusiness:         true,
		Country:            country,
		CustomerCountry:    country,
		BusinessName:       jsTrim(input.BusinessName),
		CustomerName:       name,
		CustomerState:      state,
		CustomerPostalCode: postalCode,
	}
	if billingCountry != "" && IsBuyerCountry(billingCountry) {
		details.CustomerCountry = billingCountry
	}
	if hasTaxID {
		details.TaxID = NormalizeTaxID(input.TaxID)
		details.TaxIDType = countryToTaxIDType[country]
	}
	return details, nil
}
