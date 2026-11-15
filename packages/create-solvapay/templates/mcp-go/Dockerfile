# A container for __SERVER_NAME__. Settings come from the host's environment
# (SOLVAPAY_SECRET_KEY, SOLVAPAY_PRODUCT_REF, PUBLIC_BASE_URL); .env is not
# copied in. Hosts such as Cloud Run set PORT.
FROM golang:1.26 AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -o /server .

FROM gcr.io/distroless/static-debian12
COPY --from=build /server /server
ENV PORT=8080
EXPOSE 8080
ENTRYPOINT ["/server"]
