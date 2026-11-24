# Changelog

## 1.0.3 — 2026-11-24

- Ignore empty YouTube ad-overlay scaffolding when detecting active ad playback, preventing false ad controls on regular video.
- Keep YouTube's ad-block enforcement notice visible; hiding it concealed the playback gate without restoring playback.
- Add regression coverage for empty overlay containers and the enforcement notice.
- Keep worker counter writes resilient to a failed storage operation and align the source-pattern test with the recovery queue implementation.