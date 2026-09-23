# Contributing to SavePlace

Thanks for helping build an evidence-first place-saving product.

## Before opening a pull request

1. Read the [project guide](docs/PROJECT.md), especially the data rules.
2. Keep changes focused: one provider adapter, contract, evaluation case or
   product slice per pull request.
3. Run `npm run typecheck` and `npm test`.
4. Include fixtures for deterministic behavior. Live provider checks must stay
   opt-in and must not be required for the normal test suite.

## Safety and scope

- Do not commit API keys, tokens, database URLs, downloaded media, raw social
  payloads or generated live-evaluation output.
- Use only public URLs and the smallest manually reviewed ground truth needed
  for an evaluation case.
- Do not turn the diagnostic TikTok probe into a generic fetch endpoint.
- Preserve the rule that LLM output is candidate evidence and only a
  `PlaceProvider` verifies a geographic place.
- Keep pricing unknown when it is unknown; do not substitute `$0` or a guess.

## Good first contributions

- Deterministic source-adapter fixtures and failure cases.
- Evaluation cases with documented, public ground truth.
- Provider adapter improvements that preserve typed boundaries.
- Documentation and accessibility improvements for the WebApp.

By contributing, you agree that your contribution is licensed under the
[MIT License](LICENSE).
