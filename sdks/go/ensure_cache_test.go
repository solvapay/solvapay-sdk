package solvapay

import (
	"strconv"
	"testing"
)

func TestClientCustomerWriteMethodsAreDetected(t *testing.T) {
	var client *Client
	if !clientHasMethod(client, "CreateCustomer") {
		t.Fatal("CreateCustomer should be detected on *Client")
	}
	if !clientHasMethod(client, "UpdateCustomer") {
		t.Fatal("UpdateCustomer should be detected on *Client")
	}
	if clientHasMethod(client, "NotACustomerMethod") {
		t.Fatal("missing method should not be detected")
	}
}

func TestStoreCustomerCacheEvictsPastMax(t *testing.T) {
	cache := map[string]customerCacheEntry{}
	if CustomerDedupMaxCacheSize != 1000 {
		t.Fatalf("CustomerDedupMaxCacheSize = %d, want 1000", CustomerDedupMaxCacheSize)
	}
	for i := 0; i <= CustomerDedupMaxCacheSize; i++ {
		storeCustomerCache(cache, "k"+strconv.Itoa(i), customerCacheEntry{
			value:       "cus_" + strconv.Itoa(i),
			timestampMs: int64(i),
		})
	}
	if _, ok := cache["k0"]; ok {
		t.Fatal("oldest customer cache entry should be evicted")
	}
	newest := "k" + strconv.Itoa(CustomerDedupMaxCacheSize)
	if _, ok := cache[newest]; !ok {
		t.Fatal("newest customer cache entry should remain")
	}
	if got := len(cache); got != CustomerDedupMaxCacheSize {
		t.Fatalf("cache size = %d, want %d", got, CustomerDedupMaxCacheSize)
	}
}
