package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestLiveSourceRequestsFormatJ1(t *testing.T) {
	cases := []struct {
		city string
		path string
	}{
		{city: "London", path: "/London"},
		{city: "New York", path: "/New%20York"},
	}
	for _, tc := range cases {
		t.Run(tc.city, func(t *testing.T) {
			var gotPath, gotQuery string
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				gotPath = r.URL.EscapedPath()
				gotQuery = r.URL.RawQuery
				w.Header().Set("Content-Type", "application/json")
				_, _ = w.Write([]byte(`{"current_condition":[{"temp_C":"12","FeelsLikeC":"10","humidity":"70","windspeedKmph":"15","weatherDesc":[{"value":"Partly cloudy"}]}]}`))
			}))
			t.Cleanup(srv.Close)

			src := newLiveSource(srv.URL)
			if _, err := src.Fetch(context.Background(), tc.city); err != nil {
				t.Fatal(err)
			}
			if gotPath != tc.path {
				t.Fatalf("path = %q, want %q", gotPath, tc.path)
			}
			if gotQuery != "format=j1" {
				t.Fatalf("query = %q, want format=j1", gotQuery)
			}
		})
	}
}

func TestLiveSourceErrorsOnNon200(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "Unknown location", http.StatusNotFound)
	}))
	t.Cleanup(srv.Close)

	src := newLiveSource(srv.URL)
	_, err := src.Fetch(context.Background(), "Narnia")
	if err == nil {
		t.Fatal("expected error for HTTP 404")
	}
	if !strings.Contains(err.Error(), "404") {
		t.Fatalf("error %q does not name status 404", err)
	}
}
