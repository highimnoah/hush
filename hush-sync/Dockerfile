# syntax=docker/dockerfile:1
FROM rust:1-slim AS build
WORKDIR /app
COPY . .
RUN cargo build --release

FROM debian:bookworm-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/target/release/hush-sync /usr/local/bin/hush-sync
ENV HUSH_SYNC_BIND=0.0.0.0:8787
EXPOSE 8787
CMD ["hush-sync"]
